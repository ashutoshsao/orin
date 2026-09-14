# Orin API (spec 8). Same shape as the perps images: one Bun image, the whole workspace
# copied in, `bun install` once. The API imports @repo/db from the workspace, so a per-app
# copy would need the packages anyway.
FROM oven/bun:1

WORKDIR /app

COPY . .

# Lockfile-exact, so a deploy installs what the repo was tested with.
RUN bun install --frozen-lockfile

# The migrate Job (05-migrate.yml) runs `bun run db:migrate` in packages/db against the same
# image; the API itself only serves.
WORKDIR /app/apps/api

# Non-root: the agent runs untrusted model output, but only ever inside E2B — still, nothing
# here needs root. `bun` is the unprivileged user in the base image.
USER bun

EXPOSE 4000

CMD ["bun", "src/server.ts"]
