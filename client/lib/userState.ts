let _userId = "default";

export function setCurrentUserId(id: string): void {
  _userId = id;
}

export function getCurrentUserId(): string {
  return _userId;
}
