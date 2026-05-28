import { vi, type Mock } from "vitest";

/**
 * Strongly-typed factories for the three exports of `src/db.ts`. We don't
 * call `vi.mock` here because `vi.mock` calls are hoisted to the top of the
 * importing file and must reference identifiers that exist in that file's
 * scope. Test files declare their own mocks and can opt into these
 * factories for typing:
 *
 *   const query = makeQueryMock();
 *   vi.mock("../../src/db.ts", () => ({
 *     query,
 *     queryOne: makeQueryOneMock(),
 *     withTransaction: makeWithTransactionMock(),
 *   }));
 */
export type QueryMock = Mock<
  (text: string, params?: readonly unknown[]) => Promise<unknown[]>
>;

export type QueryOneMock = Mock<
  (text: string, params?: readonly unknown[]) => Promise<unknown | null>
>;

export type WithTransactionMock = Mock<
  (fn: (client: unknown) => Promise<unknown>) => Promise<unknown>
>;

export function makeQueryMock(): QueryMock {
  return vi.fn();
}

export function makeQueryOneMock(): QueryOneMock {
  return vi.fn();
}

export function makeWithTransactionMock(): WithTransactionMock {
  return vi.fn();
}
