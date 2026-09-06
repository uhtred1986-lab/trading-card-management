# The Kotlin toolchain, in a container rather than on the machine.
#
# The owner's Windows box has no JDK, no Gradle and no Android SDK, and no
# administrator rights to install them. It does have Docker. So the toolchain
# lives here: nothing is installed on the host, the versions are written down,
# and CI runs the identical image.
#
#   docker compose run --rm contract     # tier 0/1 — a JDK is all it needs
#   docker compose run --rm android      # tier 2 — adds the Android SDK
#
# See `docs/arena-android-spec.md` §10 for what each tier can actually check.

# ─── tiers 0 and 1: the contract, and pure logic ────────────────────────────
# No Android anything. This is the image that matters first, because the
# highest risk in a thin client is not its UI — it is whether it still
# understands the server.
FROM gradle:jdk21 AS contract

ENV GRADLE_USER_HOME=/gradle

# Created here, as root, and owned by the user that will write to it. Docker
# seeds a fresh named volume from whatever the image has at the mount point —
# ownership included — so making the directory now is what stops the cache
# volume coming up root-owned, which fails Gradle before it starts with a
# baffling "could not initialize native services".
RUN mkdir -p /gradle && chown gradle:gradle /gradle

WORKDIR /work/android

# Gradle writes to the mounted source tree; running as root would leave
# root-owned build/ directories on the host that the owner cannot delete.
# `gradle` is the image's own non-root user.
USER gradle

CMD ["gradle", "--no-daemon", ":contract:test"]

# ─── tier 2: Compose rendered to PNG, still with no device ──────────────────
# Adds the Android command-line tools and one platform. ~3 GB, so it is a
# separate stage nobody pays for until screenshot tests exist.
FROM contract AS android

USER root

ENV ANDROID_HOME=/opt/android-sdk
ENV ANDROID_SDK_ROOT=$ANDROID_HOME
ENV PATH=$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools

ARG ANDROID_TOOLS=13114758
ARG COMPILE_SDK=36
ARG BUILD_TOOLS=36.0.0

RUN set -eux; \
    apt-get update && apt-get install -y --no-install-recommends unzip curl && rm -rf /var/lib/apt/lists/*; \
    mkdir -p "$ANDROID_HOME/cmdline-tools"; \
    curl -fsSL -o /tmp/tools.zip \
      "https://dl.google.com/android/repository/commandlinetools-linux-${ANDROID_TOOLS}_latest.zip"; \
    unzip -q /tmp/tools.zip -d "$ANDROID_HOME/cmdline-tools"; \
    mv "$ANDROID_HOME/cmdline-tools/cmdline-tools" "$ANDROID_HOME/cmdline-tools/latest"; \
    rm /tmp/tools.zip; \
    # Unattended, and only the licences for what is installed below.
    yes | sdkmanager --licenses > /dev/null; \
    sdkmanager --install "platforms;android-${COMPILE_SDK}" "build-tools;${BUILD_TOOLS}" "platform-tools" > /dev/null; \
    chown -R gradle:gradle "$ANDROID_HOME"

USER gradle

# No emulator here on purpose. It needs nested virtualisation that Docker on
# Windows does not give, and tier 3 — haptics, wake lock, install, real frame
# timing — is only meaningful on the owner's actual phone anyway.
CMD ["gradle", "--no-daemon", "test"]
