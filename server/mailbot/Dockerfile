FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY server/mailbot/ Mailbot/
RUN dotnet publish Mailbot/Mailbot.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:10.0-alpine
# Alpine ships no zoneinfo db: without tzdata, FindSystemTimeZoneById("Asia/Jerusalem")
# throws and the orchestrator falls back to server-local (= UTC in the container),
# storing email wall-clock times as UTC — interview times end up hours off.
RUN apk add --no-cache tzdata
WORKDIR /app
COPY --from=build /app .

# Run the Mailbot worker directly; use Render's built-in scheduler
ENTRYPOINT ["dotnet", "Mailbot.dll"]
