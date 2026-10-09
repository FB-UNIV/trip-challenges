// Print the API's environment for a load test as shell exports (#63):
//   eval "$(npx tsx loadtest/api-env.ts)" && node packages/api/dist/server.js
// Same values as e2e (e2e/support/env.ts): dev-login on, rate limits lifted, since every
// virtual student comes from one IP. The test measures the app, not the limiter.
import { apiEnv } from "../e2e/support/env.js";

const quote = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;
for (const [k, v] of Object.entries(apiEnv)) console.log(`export ${k}=${quote(v)}`);
