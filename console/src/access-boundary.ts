export const verifiedAccessAssertionHeader = "x-fde-verified-access-assertion";

export function withVerifiedAccessAssertion(request: Request, assertion: string) {
  const headers = new Headers(request.headers);
  headers.delete(verifiedAccessAssertionHeader);
  if (assertion) headers.set(verifiedAccessAssertionHeader, assertion);
  return new Request(request, { headers });
}
