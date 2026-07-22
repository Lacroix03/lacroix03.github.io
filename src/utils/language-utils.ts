export type PageLang = "ko" | "en";

export function normalizePageLang(lang?: string): PageLang {
	return lang?.toLowerCase().startsWith("en") ? "en" : "ko";
}

export function getLocalizedPath(pathname: string, lang?: string): string {
	const targetLang = normalizePageLang(lang);
	const normalizedPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
	const pathWithoutEnglishPrefix =
		normalizedPath === "/en"
			? "/"
			: normalizedPath.startsWith("/en/")
				? normalizedPath.slice(3) || "/"
				: normalizedPath;

	if (targetLang === "en") {
		return pathWithoutEnglishPrefix === "/"
			? "/en/"
			: `/en${pathWithoutEnglishPrefix}`;
	}

	return pathWithoutEnglishPrefix;
}

export function getLanguageSwitchPath(
	pathname: string,
	search: string,
	targetLang: PageLang,
): string {
	return `${getLocalizedPath(pathname, targetLang)}${search}`;
}
