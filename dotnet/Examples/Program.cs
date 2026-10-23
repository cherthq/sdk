using TryChert;

// No network effects unless the operator explicitly selects the read-only example.
if (args is not ["list-calls"])
{
    Console.WriteLine("TryChert example: list-calls reads FaceTime calls using explicit CHERT_FACETIME_* environment configuration. No requests made.");
    return;
}
static string Required(string name) => Environment.GetEnvironmentVariable(name)
    ?? throw new InvalidOperationException("Missing " + name);

using var client = new ChertClient(faceTime: new FaceTimeOptions
{
    Token = Required("CHERT_FACETIME_TOKEN"),
    ProjectId = Required("CHERT_FACETIME_PROJECT_ID")
});
using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
try
{
    var page = await client.FaceTime!.ListCallsAsync(limit: 10, cancellationToken: cancellation.Token);
    Console.WriteLine($"Received {page.Items.Length} of {page.Total} calls. No calls placed.");
}
catch (ChertApiException error)
{
    // Do not log raw responses, model serialization, credentials or arbitrary server error codes.
    Console.Error.WriteLine(error.Message);
    Environment.ExitCode = 1;
}
