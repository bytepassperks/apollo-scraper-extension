export const DEFAULT_FIELDS = [
  ["Contact ID", "contact_id"], ["First Name", "first_name"], ["Last Name", "last_name"],
  ["Full Name", "full_name"], ["LinkedIn URL", "linkedin_url"], ["Job Title", "title"],
  ["Email Status", "email_status"], ["Photo URL", "photo_url"], ["Twitter URL", "twitter_url"],
  ["GitHub URL", "github_url"], ["Facebook URL", "facebook_url"],
  ["Extrapolated Email Confidence", "extrapolated_email_confidence"],
  ["Professional Headline", "professional_headline"], ["Email Address", "email"],
  ["Organization ID", "organization_id"], ["State", "state"], ["City", "city"], ["Country", "country"],
  ["Organization Name", "organization_name"], ["Organization Website URL", "organization_website_url"],
  ["Organization Blog URL", "organization_blog_url"], ["Organization AngelList URL", "organization_angellist_url"],
  ["Organization LinkedIn URL", "organization_linkedin_url"], ["Organization Twitter URL", "organization_twitter_url"],
  ["Organization Facebook URL", "organization_facebook_url"], ["Organization Primary Phone", "organization_primary_phone"],
  ["Organization Phone Source", "organization_phone_source"], ["Organization Sanitized Phone", "organization_sanitized_phone"],
  ["Organization Languages Spoken", "organization_languages_spoken"], ["Organization Alexa Ranking", "organization_alexa_ranking"],
  ["Organization Phone Number", "organization_phone_number"], ["Organization LinkedIn UID", "organization_linkedin_uid"],
  ["Organization Founded Year", "organization_founded_year"], ["Organization Public Symbol", "organization_publicly_traded_symbol"],
  ["Organization Public Exchange", "organization_publicly_traded_exchange"], ["Organization Logo URL", "organization_logo_url"],
  ["Organization Crunchbase URL", "organization_crunchbase_url"], ["Organization Primary Domain", "organization_primary_domain"],
  ["Is Likely to Engage?", "is_likely_to_engage"], ["Departments", "departments"], ["Subdepartments", "subdepartments"],
  ["Seniority Level", "seniority"], ["Job Functions", "functions"], ["Phone Numbers", "phone_numbers"],
  ["Intent Strength", "intent_strength"], ["Show Intent Data?", "show_intent_data"],
  ["Employment History", "employment_history"]
];

const aliases = {
  contact_id: ["id", "contactId", "contact_id"],
  first_name: ["first_name", "firstName"],
  last_name: ["last_name", "lastName"],
  full_name: ["name", "full_name", "fullName"],
  linkedin_url: ["linkedin_url", "linkedinUrl", "linkedin"],
  title: ["title", "job_title", "jobTitle"],
  email_status: ["email_status", "emailStatus"],
  photo_url: ["photo_url", "photoUrl"],
  twitter_url: ["twitter_url", "twitterUrl"],
  github_url: ["github_url", "githubUrl"],
  facebook_url: ["facebook_url", "facebookUrl"],
  extrapolated_email_confidence: ["extrapolated_email_confidence"],
  professional_headline: ["professional_headline", "headline"],
  email: ["email", "email_address", "emailAddress"],
  organization_id: ["organization_id", "organizationId"],
  state: ["state"], city: ["city"], country: ["country"],
  organization_name: ["organization_name", "organizationName"],
  organization_website_url: ["website_url", "websiteUrl"],
  organization_blog_url: ["blog_url", "blogUrl"],
  organization_angellist_url: ["angellist_url", "angelListUrl"],
  organization_linkedin_url: ["linkedin_url", "linkedinUrl"],
  organization_twitter_url: ["twitter_url", "twitterUrl"],
  organization_facebook_url: ["facebook_url", "facebookUrl"],
  organization_primary_phone: ["phone_number", "phoneNumber"],
  organization_phone_source: ["phone_number_source"],
  organization_sanitized_phone: ["sanitized_phone_number"],
  organization_languages_spoken: ["languages_spoken"],
  organization_alexa_ranking: ["alexa_ranking"], organization_phone_number: ["phone_number"],
  organization_linkedin_uid: ["linkedin_uid"], organization_founded_year: ["founded_year"],
  organization_publicly_traded_symbol: ["publicly_traded_symbol"],
  organization_publicly_traded_exchange: ["publicly_traded_exchange"],
  organization_logo_url: ["logo_url"], organization_crunchbase_url: ["crunchbase_url"],
  organization_primary_domain: ["primary_domain"],
  is_likely_to_engage: ["is_likely_to_engage", "isLikelyToEngage"],
  departments: ["departments"], subdepartments: ["subdepartments"], seniority: ["seniority", "seniority_level"],
  functions: ["functions", "job_functions"], phone_numbers: ["phone_numbers"],
  intent_strength: ["intent_strength"], show_intent_data: ["show_intent_data", "showIntentData"]
};

const get = (object, key) => {
  if (!object || typeof object !== "object") return undefined;
  for (const candidate of aliases[key] || [key]) {
    if (object[candidate] !== undefined) return object[candidate];
  }
  return undefined;
};

const printable = value => value == null ? "" : Array.isArray(value) || typeof value === "object" ? JSON.stringify(value) : String(value);

export function flattenRecord(record) {
  const organization = record.organization || record.account || {};
  const result = {};
  for (const [, key] of DEFAULT_FIELDS) {
    let value = get(record, key);
    if (key.startsWith("organization_")) value = get(organization, key.replace("organization_", ""));
    if (key === "employment_history") {
      result.employment_history = JSON.stringify(record.employment_history || record.employmentHistory || []);
      const current = (record.employment_history || record.employmentHistory || []).find(item => item.is_current_role || item.isCurrentRole || item.current) || {};
      result.current_employer = current.organization_name || current.organizationName || "";
      result.current_role = current.job_title || current.jobTitle || "";
    } else result[key] = printable(value);
  }
  return result;
}

export function flattenAll(record) {
  const flattened = {};
  const walk = (value, prefix) => {
    if (Array.isArray(value)) {
      flattened[prefix] = JSON.stringify(value);
    } else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) walk(child, prefix ? `${prefix}.${key}` : key);
    } else if (prefix) flattened[prefix] = value == null ? "" : String(value);
  };
  walk(record, "");
  return flattened;
}

export function fieldDefinitions() {
  return DEFAULT_FIELDS.concat([["Current Employer", "current_employer"], ["Current Role", "current_role"]]);
}
