import "@testing-library/jest-dom/vitest";
import { File as NodeFile } from "node:buffer";
import { afterAll, afterEach, beforeAll, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { server } from "./server.js";

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
const bridge = (inner: typeof fetch): typeof fetch => async (input, init) => {
  if (init?.body instanceof FormData) {
    const body = new NodeFormData();
    for (const [key, value] of init.body) {
      body.append(key, typeof value === "string" ? value
        : (new NodeFile([await bytesOf(value)], value.name, { type: value.type }) as unknown as Blob));
    }
    init = { ...init, body };
  }
  return inner(typeof input === "string" ? new URL(input, location.origin) : input, init);
};

// After listen(): MSW swaps in its own fetch, and the bridge must sit in front of it.
let mswFetch: typeof fetch;
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
  mswFetch = globalThis.fetch;
  globalThis.fetch = bridge(mswFetch);
});
afterEach(() => {
  cleanup();
  server.resetHandlers();
  vi.restoreAllMocks();
});
afterAll(() => {
  globalThis.fetch = mswFetch;
  server.close();
});
