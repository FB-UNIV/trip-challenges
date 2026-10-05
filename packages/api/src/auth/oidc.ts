// PocketID OIDC client (ADR-0005). Discovery is memoized after first use.
import { Issuer, generators, type Client } from "openid-client";
import { config } from "../config.js";

let clientPromise: Promise<Client> | null = null;

export function getOidcClient(): Promise<Client> {
  if (!clientPromise) {
    clientPromise = Issuer.discover(config.OIDC_ISSUER).then(
      (issuer) =>
        new issuer.Client({
          client_id: config.OIDC_CLIENT_ID,
          client_secret: config.OIDC_CLIENT_SECRET,
          redirect_uris: [config.OIDC_REDIRECT_URI],
          response_types: ["code"],
        }),
    );
  }
  return clientPromise;
}

export const oidcGenerators = generators;
