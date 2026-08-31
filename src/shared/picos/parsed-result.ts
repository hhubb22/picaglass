export type ParsedResult<T> =
  | { status: 'parsed'; data: T; raw: string }
  | { status: 'parse-failed'; raw: string; reason: string }
