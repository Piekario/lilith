// This file was auto-generated by 'typesafe-i18n'. Any manual changes will be overwritten.
/* eslint-disable */

import { initFormatters } from './formatters'
import type { Locales, Translations } from './i18n-types'
import { loadedFormatters, loadedLocales, locales } from './i18n-util'

import br from './br'
import de from './de'
import en from './en'
import es from './es'
import fr from './fr'
import it from './it'
import jp from './jp'
import pl from './pl'

const localeTranslations = {
	br,
	de,
	en,
	es,
	fr,
	it,
	jp,
	pl,
}

export const loadLocale = (locale: Locales): void => {
	if (loadedLocales[locale]) return

	loadedLocales[locale] = localeTranslations[locale] as unknown as Translations
	loadFormatters(locale)
}

export const loadAllLocales = (): void => locales.forEach(loadLocale)

export const loadFormatters = (locale: Locales): void =>
	void (loadedFormatters[locale] = initFormatters(locale))