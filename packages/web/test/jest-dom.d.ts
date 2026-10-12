// jest-dom's matchers on vitest's `expect`, registered in setup.ts. Declared here rather than
// via "@testing-library/jest-dom/vitest" so `vitest` resolves to this workspace's copy.
import "vitest";
import type { TestingLibraryMatchers } from "@testing-library/jest-dom/matchers";

declare module "vitest" {
  interface Assertion<T = any> extends TestingLibraryMatchers<any, T> {}
  interface AsymmetricMatchersContaining extends TestingLibraryMatchers<any, any> {}
}
