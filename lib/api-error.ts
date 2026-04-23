import { NextResponse } from "next/server";

type ErrorBody = {
  error: { code: string; message: string; details: Record<string, never> };
};

export function jsonError(
  status: number,
  code: string,
  message: string,
): NextResponse<ErrorBody> {
  return NextResponse.json(
    { error: { code, message, details: {} } },
    { status },
  );
}
