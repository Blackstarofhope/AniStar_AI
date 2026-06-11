let _userId: string | null = null;

export function setCurrentUserId(id: string): void {
  _userId = id;
}

export function getCurrentUserId(): string | null {
  return _userId;
}
