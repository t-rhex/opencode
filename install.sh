#!/usr/bin/env bash
# opencode-remote installer
# Usage: curl -fsSL https://raw.githubusercontent.com/t-rhex/opencode/dev/install.sh | bash
#
# Environment variables:
#   OPENCODE_REMOTE_VERSION  - version to install (default: latest)
#   OPENCODE_REMOTE_INSTALL  - install directory (default: ~/.local/bin)

set -euo pipefail

REPO="t-rhex/opencode"
BINARY="opencode-remote"
VERSION="${OPENCODE_REMOTE_VERSION:-}"
INSTALL_DIR="${OPENCODE_REMOTE_INSTALL:-}"

info()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
error() { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

detect_platform() {
  case "$(uname -s)" in
    Darwin)  echo "darwin" ;;
    Linux)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "windows" ;;
    *) error "Unsupported OS: $(uname -s)" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)  echo "x64" ;;
    aarch64|arm64)  echo "arm64" ;;
    *) error "Unsupported architecture: $(uname -m)" ;;
  esac
}

detect_libc() {
  if [ "$(detect_platform)" != "linux" ]; then
    echo ""
    return
  fi
  if ldd --version 2>&1 | grep -qi musl; then
    echo "-musl"
  elif [ -f /etc/alpine-release ]; then
    echo "-musl"
  else
    echo ""
  fi
}

resolve_version() {
  if [ -n "$VERSION" ]; then
    echo "$VERSION"
    return
  fi
  local latest
  latest=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases" \
    | grep '"tag_name"' | head -1 | sed 's/.*"tag_name": *"//;s/".*//')
  if [ -z "$latest" ]; then
    error "Could not determine latest version"
  fi
  echo "$latest"
}

resolve_install_dir() {
  if [ -n "$INSTALL_DIR" ]; then
    echo "$INSTALL_DIR"
    return
  fi
  if [ -n "${XDG_BIN_HOME:-}" ]; then
    echo "$XDG_BIN_HOME"
    return
  fi
  local candidate="$HOME/.local/bin"
  mkdir -p "$candidate"
  echo "$candidate"
}

main() {
  local platform arch libc version dir ext archive url tmp

  platform=$(detect_platform)
  arch=$(detect_arch)
  libc=$(detect_libc)
  version=$(resolve_version)
  dir=$(resolve_install_dir)
  mkdir -p "$dir"

  info "Installing ${BINARY} ${version}"
  info "Platform: ${platform}-${arch}${libc}"

  if [ "$platform" = "linux" ]; then
    ext="tar.gz"
  else
    ext="zip"
  fi

  archive="dist-opencode-${platform}-${arch}${libc}.${ext}"
  url="https://github.com/${REPO}/releases/download/${version}/${archive}"

  info "Downloading ${url}"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  curl -fsSL -o "${tmp}/${archive}" "$url" || error "Download failed. Check that version ${version} exists."

  info "Extracting..."
  if [ "$ext" = "tar.gz" ]; then
    tar -xzf "${tmp}/${archive}" -C "$tmp"
  else
    unzip -q -o "${tmp}/${archive}" -d "$tmp"
  fi

  # Handle both old (opencode) and new (opencode-remote) binary names
  local src=""
  if [ -f "${tmp}/${BINARY}" ]; then
    src="${tmp}/${BINARY}"
  elif [ -f "${tmp}/opencode" ]; then
    src="${tmp}/opencode"
  elif [ "$platform" = "windows" ] && [ -f "${tmp}/${BINARY}.exe" ]; then
    src="${tmp}/${BINARY}.exe"
  elif [ "$platform" = "windows" ] && [ -f "${tmp}/opencode.exe" ]; then
    src="${tmp}/opencode.exe"
  else
    error "Binary not found in archive"
  fi

  local dest="${dir}/${BINARY}"
  if [ "$platform" = "windows" ]; then
    dest="${dir}/${BINARY}.exe"
  fi

  cp "$src" "$dest"
  chmod +x "$dest"

  info "Installed to ${dest}"

  # Check if install dir is in PATH
  case ":${PATH}:" in
    *":${dir}:"*) ;;
    *)
      printf "\n"
      info "Add ${dir} to your PATH:"
      printf "\n"
      echo "  export PATH=\"${dir}:\$PATH\""
      printf "\n"
      echo "  # Add to your shell profile (~/.bashrc, ~/.zshrc, etc.):"
      echo "  echo 'export PATH=\"${dir}:\$PATH\"' >> ~/.bashrc"
      printf "\n"
      ;;
  esac

  info "Done! Run '${BINARY}' to get started."
  "${dest}" --version 2>/dev/null && true
}

main "$@"
