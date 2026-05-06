#!/usr/bin/env bash
# Commit staged/working changes, bump the semver tag, and push both so the
# GHCR workflow publishes a new versioned image alongside :latest.
#
# Usage:
#   ./commit-and-push.sh "commit message"            # auto patch bump
#   ./commit-and-push.sh -p "commit message"         # patch bump (default)
#   ./commit-and-push.sh -m "commit message"         # minor bump
#   ./commit-and-push.sh -M "commit message"         # major bump
#   ./commit-and-push.sh -t v1.9.0 "commit message"  # explicit tag
#   ./commit-and-push.sh --no-bump "commit message"  # commit + push, no new tag
#
# Tag format: vMAJOR.MINOR.PATCH. The script refuses to push if the tag
# already exists locally or on origin.

set -euo pipefail

bump="patch"
explicit_tag=""
do_bump=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    -M|--major) bump="major"; shift ;;
    -m|--minor) bump="minor"; shift ;;
    -p|--patch) bump="patch"; shift ;;
    -t|--tag)   explicit_tag="${2:-}"; shift 2 ;;
    --no-bump)  do_bump=0; shift ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    --) shift; break ;;
    -*) echo "unknown flag: $1" >&2; exit 2 ;;
    *) break ;;
  esac
done

message="${1:-}"
if [[ -z "$message" ]]; then
  echo "error: commit message required" >&2
  echo "usage: $0 [-M|-m|-p|-t vX.Y.Z|--no-bump] \"commit message\"" >&2
  exit 2
fi

cd "$(dirname "$0")"

if [[ -z "$(git status --porcelain)" ]]; then
  echo "error: no changes to commit" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" != "master" ]]; then
  echo "error: must be on master, currently on $branch" >&2
  exit 1
fi

git fetch --tags --quiet origin

if (( do_bump )); then
  if [[ -n "$explicit_tag" ]]; then
    new_tag="$explicit_tag"
    [[ "$new_tag" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "error: tag must match vX.Y.Z" >&2; exit 2; }
  else
    last_tag="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -n1)"
    if [[ -z "$last_tag" ]]; then last_tag="v0.0.0"; fi
    IFS='.' read -r maj min pat <<<"${last_tag#v}"
    case "$bump" in
      major) maj=$((maj+1)); min=0; pat=0 ;;
      minor) min=$((min+1)); pat=0 ;;
      patch) pat=$((pat+1)) ;;
    esac
    new_tag="v${maj}.${min}.${pat}"
  fi

  if git rev-parse -q --verify "refs/tags/$new_tag" >/dev/null; then
    echo "error: tag $new_tag already exists locally" >&2
    exit 1
  fi
  if git ls-remote --exit-code --tags origin "$new_tag" >/dev/null 2>&1; then
    echo "error: tag $new_tag already exists on origin" >&2
    exit 1
  fi
fi

sw_file="webreader/public/service-worker.js"
if (( do_bump )) && [[ -f "$sw_file" ]]; then
  # Cache-bust installed PWAs: tie service worker cache name to the new tag so
  # the activate handler purges every previous shell cache.
  new_cache="yacreaderweb-shell-${new_tag}"
  if grep -q "^const CACHE_NAME = '" "$sw_file"; then
    sed -i "s|^const CACHE_NAME = '.*';|const CACHE_NAME = '${new_cache}';|" "$sw_file"
    echo "service worker CACHE_NAME -> ${new_cache}"
  fi
fi

git add -A
git commit -m "$message"

if (( do_bump )); then
  git tag -a "$new_tag" -m "$new_tag"
  git push origin master
  git push origin "$new_tag"
  echo
  echo "pushed commit + tag $new_tag"
  echo "GHCR will publish:"
  echo "  ghcr.io/<owner>/yacreaderweb:latest"
  echo "  ghcr.io/<owner>/yacreaderweb:${new_tag#v}"
else
  git push origin master
  echo
  echo "pushed commit (no tag bump)"
fi
