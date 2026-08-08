import { Prisma } from '@prisma/client';

const cache = new Map<string, Set<string> | null>();

/**
 * Returns the set of writable scalar/enum field names (camelCase, as exposed by
 * the Prisma client) for a model, given its delegate name (e.g. `project`,
 * `boqItem`). Relation object fields are excluded. Used by the generic CRUD
 * router to drop unknown keys from request bodies before `create`/`update`.
 * Returns `null` if the model can't be resolved (caller should then skip
 * filtering and let Prisma validate).
 */
export function modelScalarFields(delegateName: string): Set<string> | null {
  if (cache.has(delegateName)) return cache.get(delegateName) ?? null;
  const pascal = delegateName.charAt(0).toUpperCase() + delegateName.slice(1);
  const model = Prisma.dmmf?.datamodel?.models?.find((m) => m.name === pascal);
  if (!model) {
    cache.set(delegateName, null);
    return null;
  }
  const set = new Set<string>();
  for (const field of model.fields) {
    if (field.kind === 'scalar' || field.kind === 'enum') set.add(field.name);
  }
  cache.set(delegateName, set);
  return set;
}
