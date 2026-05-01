/** Used as part of S3 bucket names by setup.sh — keep it conservative. */
export function isValidProjectName(s: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(s);
}

export function isValidRegion(s: string): boolean {
  return /^[a-z]{2,3}-[a-z]+-\d$/.test(s);
}

export function isValidDomain(s: string): boolean {
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(s);
}
