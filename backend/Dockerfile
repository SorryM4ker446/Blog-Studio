FROM golang:1.25-alpine AS build

WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .

ARG TARGETOS=linux
ARG TARGETARCH
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server \
    && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/migrate ./cmd/migrate \
    && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/seed ./cmd/seed \
    && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/backup ./cmd/backup \
    && CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w" -o /out/restore ./cmd/restore

FROM alpine:3.23 AS runtime

RUN apk add --no-cache ca-certificates curl tzdata \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && install -d -o app -g app /app /data/uploads

WORKDIR /app
COPY --from=build --chown=app:app /out/server /out/migrate /out/seed ./

USER app
EXPOSE 8080
CMD ["/app/server"]

FROM postgres:18-alpine AS maintenance

WORKDIR /app
RUN install -d -o 10001 -g 10001 /app /backups
COPY --from=build --chown=10001:10001 /out/backup /out/restore ./
USER 10001:10001
ENTRYPOINT []
CMD ["/bin/true"]
