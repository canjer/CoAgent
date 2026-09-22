/** Public, credential-free classifications; never pass through upstream response bodies. */
export function classifyProviderStatus(status: number) {
  const codes: Record<number, string> = {
    400: 'provider_bad_request', 401: 'provider_authentication_failed',
    402: 'provider_payment_required', 403: 'provider_access_denied',
    404: 'provider_endpoint_not_found', 422: 'provider_invalid_parameters',
    429: 'provider_rate_limited',
  };
  return {
    code: codes[status] ?? (status >= 500 ? 'provider_unavailable' : 'provider_http_error'),
    httpStatus: status,
    retryable: status === 429 || status >= 500,
  };
}
