import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { File as NodeFile } from "node:buffer";
import { afterAll, afterEach, beforeAll, beforeEach, expect, vi } from "vitest";
import { http, HttpResponse } from "msw";
import { cleanup } from "@testing-library/react";
import { server } from "./server.js";

// Not "@testing-library/jest-dom/vitest": that entry imports `vitest` from the hoisted root,
// where there is none (vitepress pins the root's vite to 5, so each workspace keeps its own).
expect.extend(jestDomMatchers);

// fetch here is Node's, the DOM is jsdom's. Bridge the two the way a browser would:
// - relative URLs ("/api/...") resolve against the page origin;
// - a jsdom FormData (photo upload) becomes Node's, or it would be sent as "[object FormData]".
const NodeFormData = (await new Response("", { headers: { "content-type": "application/x-www-form-urlencoded" } }).formData()).constructor as typeof FormData;
// jsdom's File has no arrayBuffer(); FileReader is what it does support.
const bytesOf = (file: File) => new Promise<ArrayBuffer>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(reader.result as ArrayBuffer);
  reader.onerror = () => reject(reader.error);
  reader.readAsArrayBuffer(file);
});
async function toNodeFormData(form: FormData): Promise<FormData> {
  const body = new NodeFormData();
  for (const [key, value] of form) {
    body.append(key, typeof value === "string" ? value
      : (new NodeFile([new Uint8Array(await bytesOf(value))], value.name, { type: value.type }) as unknown as Blob));
  }
  return body;
}
const bridge = (inner: typeof fetch): typeof fetch => async (input, init) => {
  if (init?.body instanceof FormData) init = { ...init, body: await toNodeFormData(init.body) };
  return inner(typeof input === "string" ? new URL(input, location.origin) : input, init);
};

// Encoded by hand: Node's encoder doesn't recognize jsdom's File (no name, no bytes).
async function multipartOf(form: FormData): Promise<{ type: string; bytes: Uint8Array<ArrayBuffer> }> {
  const boundary = "----trip-test-boundary";
  const parts: Uint8Array[] = [];
  const text = (t: string) => parts.push(new TextEncoder().encode(t));
  for (const [key, value] of form) {
    if (typeof value === "string") {
      text(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`);
    } else {
      text(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"; filename="${value.name}"\r\nContent-Type: ${value.type}\r\n\r\n`);
      parts.push(new Uint8Array(await bytesOf(value)));
      text("\r\n");
    }
  }
  text(`--${boundary}--\r\n`);
  const bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  parts.reduce((at, p) => { bytes.set(p, at); return at + p.length; }, 0);
  return { type: `multipart/form-data; boundary=${boundary}`, bytes };
}

// The same for XMLHttpRequest (photo uploads use it for their progress): MSW would read a
// jsdom FormData as "[object FormData]", so send the multipart bytes a browser would.
const bridgeXhr = (Inner: typeof XMLHttpRequest) => function BridgedXhr() {
  const xhr = new Inner();
  const send = (body?: Document | XMLHttpRequestBodyInit | null) => {
    if (!(body instanceof FormData)) return xhr.send(body);
    void multipartOf(body).then(({ type, bytes }) => {
      xhr.setRequestHeader("content-type", type);
      xhr.send(bytes);
    });
  };
  // A proxy: MSW's own XMLHttpRequest proxy ignores assignments to `send`.
  return new Proxy(xhr, {
    get: (target, key) => {
      if (key === "send") return send;
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set: (target, key, value) => Reflect.set(target, key, value),
  });
} as unknown as typeof XMLHttpRequest;

// jsdom has no object URLs (photo previews): hand out unique ones, as a browser would.
let objectUrls = 0;
URL.createObjectURL ??= () => `blob:${location.origin}/${++objectUrls}`;
URL.revokeObjectURL ??= () => {};

// MSW defines its XMLHttpRequest read-only (but configurable).
const setXhr = (value: typeof XMLHttpRequest) =>
  Object.defineProperty(globalThis, "XMLHttpRequest", { value, configurable: true, writable: false });

// After listen(): MSW swaps in its own fetch and XMLHttpRequest, and the bridges must sit in front.
let mswFetch: typeof fetch;
let mswXhr: typeof XMLHttpRequest;
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  mswFetch = globalThis.fetch;
  globalThis.fetch = bridge(mswFetch);
  mswXhr = globalThis.XMLHttpRequest;
  setXhr(bridgeXhr(mswXhr));
});
// App shell: on student pages the tab bar asks who's signed in and for their challenge
// progress. Default to "signed out" so screens that don't care needn't declare it; a test's
// own server.use(...) takes precedence.
beforeEach(() => {
  server.use(
    http.get("/api/student/me", () => HttpResponse.json({ error: "unauthorized" }, { status: 401 })),
    http.get("/api/challenges/for-student", () => HttpResponse.json({ challenges: [] })),
  );
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  globalThis.fetch = mswFetch;
  setXhr(mswXhr);
  server.close();
});
