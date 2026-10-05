// Central config from env. Fails fast if required secrets are missing.
import { Env, type Config } from "./env-schema.js";

export const config = Env.parse(process.env);
export type { Config };
