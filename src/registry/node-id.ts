/**
 * Registry tree node ids are path-like (`scope:s1/group:g/project:p`), so a
 * node's descendants all share its id as a `/`-delimited prefix. This is the
 * single home for that "self-or-descendant" test, shared by the subscription
 * set, the child cache, and the service's package-group cache so the pruning
 * rule can't drift between them.
 */

/** True when `id` is `base` itself or a descendant (path-prefix) of it. */
export function isSelfOrDescendant(id: string, base: string): boolean {
    return id === base || id.startsWith(base + '/');
}
