# BackdropAds API (.NET 9)
FROM mcr.microsoft.com/dotnet/sdk:9.0 AS build
WORKDIR /src
COPY BackdropAds.Api.csproj .
RUN dotnet restore
COPY . .
RUN dotnet publish -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:9.0
WORKDIR /app
COPY --from=build /app .
# Media (generated images / videos, uploads) lives in /data — mount a volume there.
RUN mkdir -p /data/media && chown -R app:app /data
ENV ASPNETCORE_HTTP_PORTS=8080 \
    Storage__Folder=/data/media
USER app
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["dotnet", "BackdropAds.Api.dll"]
