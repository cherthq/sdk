# Verification

Use the [local check commands](../INTEGRATION.md) for the current checkout.
The JavaScript suite covers SDK and adapter request/response contracts, unsafe
inputs, credential boundaries, cancellation and uncertain outcomes. Package and
distribution checks cover packed imports, declarations and supported runtimes.

Tests use synthetic data with injected fetch or loopback HTTP. A passing test is
not evidence of deployed route availability, real authentication, message
delivery, call completion or media playback. No live credentials or device
access are required. Test counts and artifact hashes are revision-specific;
consult the current CI run rather than a historical checkpoint.
