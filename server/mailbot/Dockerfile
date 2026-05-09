FROM mcr.microsoft.com/dotnet/sdk:10.0-alpine AS build
WORKDIR /src
COPY Mailbot/ Mailbot/
RUN dotnet publish Mailbot/Mailbot.csproj -c Release -o /app

FROM mcr.microsoft.com/dotnet/runtime:10.0-alpine
WORKDIR /app
COPY --from=build /app .

# Run the Mailbot worker directly; use Render's built-in scheduler
ENTRYPOINT ["dotnet", "Mailbot.dll"]
