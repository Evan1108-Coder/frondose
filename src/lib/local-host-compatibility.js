// Identify only an unavailable feature namespace, never a missing file/entity.
const features={'file-comments':'Review comments','local-automations':'Local automations','repository-work':'Repository tools'};
export function localHostUpgradeProblem(path,error){
 if(error?.status!==404||!/^Unknown API route:/i.test(error.message||''))return null;
 const name=String(path).replace(/^\/api\//,'').split(/[/?]/)[0],feature=features[name];
 return feature?{code:'local_host_upgrade_required',message:feature+' need the updated local server. Save your work and restart Frondose’s server when it is safe; no terminal was stopped automatically.'}:null;
}
