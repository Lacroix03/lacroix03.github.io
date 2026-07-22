import I18nKey from "@i18n/i18nKey";
import { getTranslation } from "@i18n/translation";
import { siteConfig } from "../config";
import { getLocalizedPath } from "./language-utils";

export function pathsEqual(path1: string, path2: string) {
	const normalizedPath1 = path1.replace(/^\/|\/$/g, "").toLowerCase();
	const normalizedPath2 = path2.replace(/^\/|\/$/g, "").toLowerCase();
	return normalizedPath1 === normalizedPath2;
}

function joinUrl(...parts: string[]): string {
	const joined = parts.join("/");
	return joined.replace(/\/+/g, "/");
}

export function getPostUrlBySlug(slug: string, lang = siteConfig.lang): string {
	return url(getLocalizedPath(`/posts/${slug}/`, lang));
}

export function getTagUrl(tag: string, lang = siteConfig.lang): string {
	const archivePath = getLocalizedPath("/archive/", lang);
	if (!tag) return url(archivePath);
	return url(`${archivePath}?tag=${encodeURIComponent(tag.trim())}`);
}

export function getCategoryUrl(
	category: string | null,
	lang = siteConfig.lang,
): string {
	const archivePath = getLocalizedPath("/archive/", lang);
	const translation = getTranslation(lang);
	if (
		!category ||
		category.trim() === "" ||
		category.trim().toLowerCase() ===
			translation[I18nKey.uncategorized].toLowerCase()
	)
		return url(`${archivePath}?uncategorized=true`);
	return url(`${archivePath}?category=${encodeURIComponent(category.trim())}`);
}

export function getDir(path: string): string {
	const lastSlashIndex = path.lastIndexOf("/");
	if (lastSlashIndex < 0) {
		return "/";
	}
	return path.substring(0, lastSlashIndex + 1);
}

export function url(path: string) {
	return joinUrl("", import.meta.env.BASE_URL, path);
}
