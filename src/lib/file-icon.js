// Filename presentation only: never reads files or infers permissions/security.
const groups={
 code:new Set('js mjs cjs jsx ts tsx py pyw rb go rs java kt kts c cc cpp cxx h hpp cs swift php vue svelte astro html htm xml css scss sass less graphql gql'.split(' ')),
 shell:new Set('sh bash zsh fish ps1 psm1 cmd bat'.split(' ')),
 image:new Set('svg png jpg jpeg gif webp avif bmp ico icns tiff tif heic'.split(' ')),
 archive:new Set('zip gz bz2 xz tar tgz 7z rar zst dmg iso'.split(' ')),
 audio:new Set('mp3 wav ogg flac aac m4a opus aiff'.split(' ')),
 video:new Set('mp4 mov webm mkv avi m4v'.split(' ')),
 table:new Set('csv tsv xls xlsx ods'.split(' ')),
 font:new Set('woff woff2 ttf otf'.split(' ')),
 database:new Set('sql db sqlite sqlite3 prisma'.split(' ')),
 document:new Set('md markdown mdown mdx txt rst rtf pdf doc docx odt'.split(' ')),
 config:new Set('yaml yml toml ini cfg conf properties editorconfig'.split(' ')),
};
export function fileIconKind(path=''){
 const name=String(path??'').replaceAll('\\','/').split('/').at(-1).toLowerCase();
 if(/^\.env(?:\.|$)/.test(name))return 'environment';
 if(/(?:^|[-.])lock(?:b)?(?:\.(?:json|ya?ml))?$/.test(name)||/^(?:package-lock\.json|npm-shrinkwrap\.json|cargo\.lock|gemfile\.lock|poetry\.lock|uv\.lock)$/.test(name))return 'lock';
 if(/^(?:package\.json|cargo\.toml|go\.mod|pyproject\.toml|composer\.json|gemfile)$/.test(name))return 'package';
 if(/^(?:dockerfile(?:\..*)?|makefile|justfile|\.gitignore|\.gitattributes|\.gitmodules|\.npmrc|\.nvmrc|\.editorconfig)$/.test(name))return 'config';
 if(/(?:^|\.)config(?:\.|$)/.test(name)||/^(?:tsconfig|jsconfig)(?:\..*)?\.json$/.test(name)||/^\.(?:prettierrc|eslintrc)(?:\.|$)/.test(name))return 'config';
 const ext=name.includes('.')?name.split('.').at(-1):'';
 if(['json','jsonc','json5','ipynb'].includes(ext))return 'data';
 for(const [kind,extensions] of Object.entries(groups))if(extensions.has(ext))return kind;
 if(/^(?:readme|license|licence|notice|copying|changelog)(?:\.|$)/.test(name))return 'document';
 return 'file';
}
