FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY server/mailbot/ Mailbot/
RUN dotnet publish Mailbot/Mailbot.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:10.0-alpine
WORKDIR /app
COPY --from=build /app .

# The Alpine .NET images ship without IANA zone data. Without it,
# TimeZoneInfo.FindSystemTimeZoneById("Asia/Jerusalem") throws, and every
# email wall-clock time ("14:00") got stored as 14:00 UTC — displayed as 17:00.
RUN apk add --no-cache tzdata

# One-shot worker: run by the host scheduler (deploy/systemd), not a service.
ENTRYPOINT ["dotnet", "Mailbot.dll"]
