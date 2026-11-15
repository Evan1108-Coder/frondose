// BCP 47 locale IDs are intentionally allowlisted. A locale can supply formatting
// without having its own translated interface. Keep those states distinct.
const entries = [
  ['en', 'English', 'English', 'EN', 'full'],
  ['zh-Hans', '简体中文', 'Simplified Chinese', '简', 'preview', 'Mandarin Chinese zh CN 普通话 简体'],
  ['zh-Hant', '繁體中文', 'Traditional Chinese', '繁', 'preview', 'Mandarin Chinese zh TW HK 國語 繁體'],
  ['fr', 'Français', 'French', 'FR', 'preview'],
  ['de', 'Deutsch', 'German', 'DE', 'preview'],
  ['it', 'Italiano', 'Italian', 'IT', 'preview'],
  ['ja', '日本語', 'Japanese', 'JA', 'preview'],
  ['ko', '한국어', 'Korean', 'KO', 'preview'],
  ['pt-BR', 'Português (Brasil)', 'Portuguese (Brazil)', 'PT-BR', 'preview', 'Brazilian Portuguese'],
  ['es', 'Español', 'Spanish', 'ES', 'preview', 'Castilian Castellano'],
  ['af', 'Afrikaans', 'Afrikaans'],
  ['sq', 'Shqip', 'Albanian'],
  ['am', 'አማርኛ', 'Amharic'],
  ['ar', 'العربية', 'Arabic'],
  ['hy', 'Հայերեն', 'Armenian'],
  ['az', 'Azərbaycanca', 'Azerbaijani'],
  ['eu', 'Euskara', 'Basque'],
  ['bn', 'বাংলা', 'Bengali'],
  ['bs', 'Bosanski', 'Bosnian'],
  ['bg', 'Български', 'Bulgarian'],
  ['my', 'မြန်မာ', 'Burmese', null, null, 'Myanmar'],
  ['ca', 'Català', 'Catalan'],
  ['hr', 'Hrvatski', 'Croatian'],
  ['cs', 'Čeština', 'Czech'],
  ['da', 'Dansk', 'Danish'],
  ['nl', 'Nederlands', 'Dutch'],
  ['en-AU', 'English (Australia)', 'English (Australia)'],
  ['en-CA', 'English (Canada)', 'English (Canada)'],
  ['en-GB', 'English (United Kingdom)', 'English (United Kingdom)', null, null, 'British UK'],
  ['en-US', 'English (United States)', 'English (United States)', null, null, 'American USA'],
  ['et', 'Eesti', 'Estonian'],
  ['fil', 'Filipino', 'Filipino', null, null, 'Tagalog'],
  ['fi', 'Suomi', 'Finnish'],
  ['gl', 'Galego', 'Galician'],
  ['ka', 'ქართული', 'Georgian'],
  ['el', 'Ελληνικά', 'Greek'],
  ['gu', 'ગુજરાતી', 'Gujarati'],
  ['he', 'עברית', 'Hebrew'],
  ['hi', 'हिन्दी', 'Hindi'],
  ['hu', 'Magyar', 'Hungarian'],
  ['is', 'Íslenska', 'Icelandic'],
  ['id', 'Bahasa Indonesia', 'Indonesian'],
  ['ga', 'Gaeilge', 'Irish'],
  ['kn', 'ಕನ್ನಡ', 'Kannada'],
  ['kk', 'Қазақша', 'Kazakh'],
  ['km', 'ខ្មែរ', 'Khmer'],
  ['lo', 'ລາວ', 'Lao'],
  ['lv', 'Latviešu', 'Latvian'],
  ['lt', 'Lietuvių', 'Lithuanian'],
  ['mk', 'Македонски', 'Macedonian'],
  ['ms', 'Bahasa Melayu', 'Malay'],
  ['ml', 'മലയാളം', 'Malayalam'],
  ['mr', 'मराठी', 'Marathi'],
  ['mn', 'Монгол', 'Mongolian'],
  ['ne', 'नेपाली', 'Nepali'],
  ['nb', 'Norsk bokmål', 'Norwegian Bokmål'],
  ['fa', 'فارسی', 'Persian', null, null, 'Farsi'],
  ['pl', 'Polski', 'Polish'],
  ['pt-PT', 'Português (Portugal)', 'Portuguese (Portugal)'],
  ['pa', 'ਪੰਜਾਬੀ', 'Punjabi'],
  ['ro', 'Română', 'Romanian'],
  ['ru', 'Русский', 'Russian'],
  ['sr', 'Српски', 'Serbian'],
  ['sk', 'Slovenčina', 'Slovak'],
  ['sl', 'Slovenščina', 'Slovenian'],
  ['es-419', 'Español (Latinoamérica)', 'Spanish (Latin America)', null, null, 'Latin American Spanish'],
  ['es-ES', 'Español (España)', 'Spanish (Spain)'],
  ['es-MX', 'Español (México)', 'Spanish (Mexico)'],
  ['sw', 'Kiswahili', 'Swahili'],
  ['sv', 'Svenska', 'Swedish'],
  ['ta', 'தமிழ்', 'Tamil'],
  ['te', 'తెలుగు', 'Telugu'],
  ['th', 'ไทย', 'Thai'],
  ['tr', 'Türkçe', 'Turkish'],
  ['uk', 'Українська', 'Ukrainian'],
  ['ur', 'اردو', 'Urdu'],
  ['uz', 'Oʻzbekcha', 'Uzbek'],
  ['vi', 'Tiếng Việt', 'Vietnamese'],
  ['cy', 'Cymraeg', 'Welsh'],
  ['zu', 'IsiZulu', 'Zulu'],
];

const searchText = text => text.toLowerCase().normalize('NFD').replace(/(\p{Script=Latin})\p{M}+/gu, '$1').replace(/[-_’ʻ']/g, ' ').trim();
export const INTERFACE_LANGUAGES = Object.freeze(entries.map(([id, label, englishName, code, coverage, aliases]) => Object.freeze({
  id, label, englishName, code: code ?? id.toUpperCase(), coverage: coverage ?? 'locale-only',
  search: searchText(`${label} ${englishName} ${id} ${aliases ?? ''}`),
})));
const byId = new Map(INTERFACE_LANGUAGES.map(row => [row.id, row]));

export function getInterfaceLanguage(value) {
  return byId.get(value) ?? INTERFACE_LANGUAGES[0];
}

export function searchInterfaceLanguages(query) {
  const tokens = searchText(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return INTERFACE_LANGUAGES;
  const matches = INTERFACE_LANGUAGES.filter(row => tokens.every(token => row.search.includes(token)));
  // A language code should surface its exact match before words that happen to contain it.
  const direct = byId.get(query.trim().replaceAll('_', '-')) ?? matches.find(row => row.id.toLowerCase() === query.trim().replaceAll('_', '-').toLowerCase());
  return direct ? [direct, ...matches.filter(row => row !== direct)] : matches;
}
