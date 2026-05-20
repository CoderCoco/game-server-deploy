/**
 * Cloud-agnostic interface for reading and writing secrets in a key-value store.
 * Implementations may target AWS Secrets Manager, Azure Key Vault, GCP Secret Manager,
 * or any other backend — callers depend only on this contract.
 */
export interface SecretsStore {
  /**
   * Retrieves the value of a secret by name.
   *
   * @param name - The name (identifier) of the secret to retrieve.
   * @returns The secret value as a string, or `undefined` if no secret with
   *   that name exists in the store.
   */
  get(name: string): Promise<string | undefined>;

  /**
   * Stores a secret value under the given name, creating or overwriting the
   * secret as needed.
   *
   * @param name  - The name (identifier) to store the secret under.
   * @param value - The plaintext value to store.
   */
  put(name: string, value: string): Promise<void>;

  /**
   * Checks whether a secret with the given name exists in the store.
   *
   * @param name - The name (identifier) to look up.
   * @returns `true` if the secret exists, `false` otherwise.
   */
  exists(name: string): Promise<boolean>;
}
