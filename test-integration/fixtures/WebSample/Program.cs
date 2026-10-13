var app = WebApplication.CreateBuilder(args).Build();

app.MapGet("/", () => "dotpilot-v1");
app.MapGet("/boom", () => { throw new InvalidOperationException("dotpilot-boom"); });

app.Run();
