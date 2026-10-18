/**
 * ArcTrace shared types, Zod schemas, domain strings and the public
 * attribute allow-list (spec.md section 3 and 4.3).
 *
 * Split into modules to keep import graph acyclic; this barrel re-exports
 * everything. Deep imports (`@arctrace/shared/api`) also work.
 */
export * from "./constants.js";
export * from "./records.js";
export * from "./api.js";
export * from "./bundle.js";
