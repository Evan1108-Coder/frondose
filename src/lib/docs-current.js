// Current local product wording supersedes historical chat-first guides.
export function currentLocalGuide(article){
 const copy={...article,sections:article.sections.map(section=>({...section,paragraphs:[...(section.paragraphs||[])]}))};
 for(const section of copy.sections) section.paragraphs=section.paragraphs.map(text=>text.replaceAll('for a fresh context preview','for fresh draft context without a preview popup'));
 if(copy.id==='navigation')copy.sections.push({id:'retired-runs',title:'Retired Runs navigation',paragraphs:['The Runs page is no longer in navigation, search or customization. Existing historical run records are preserved, not deleted. Vertical tab action buttons remain horizontal. Drag a grouped view header onto the tab bar to detach it to its own tab without stopping its backing process.']});
 if(copy.id==='files-search'||copy.id==='documents')copy.related=[...new Set([...(copy.related||[]),'rich-writing'])];
 if(copy.id==='terminals')copy.related=[...new Set([...(copy.related||[]),'quick-commands'])];
 return copy;
}
