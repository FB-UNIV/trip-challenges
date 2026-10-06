// MSW server for the API. Tests declare exactly the endpoints a screen should hit
// (server.use(...)); any other request fails the test (onUnhandledRequest: "error").
import { setupServer } from "msw/node";

export const server = setupServer();
