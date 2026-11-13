import type { Category } from "@/lib/onboarding";
import type { Lang } from "@/lib/i18n";

type L = Record<Lang, string>;
export type Opt = { value: string; label: L };
export interface Question {
  section: 0 | 1 | 2;
  title: L | ((ctx: { petName: string }) => L);
  kind: "text" | "single" | "multi" | "custom";
  field?: string;
  options?: Opt[];
  max?: number;
  placeholder?: L;
}

const o = (value: string, en: string, he: string): Opt => ({ value, label: { en, he } });

export const SECTIONS: L[] = [
  { en: "About you", he: "קצת עלייך" },
  { en: "Your music", he: "המוזיקה שלך" },
  { en: "Your world", he: "העולם שלך" },
];

export const QUESTIONS: Record<Category, Question> = {
  display_name: { section: 0, kind: "text", field: "text", title: { en: "What do people call you day to day?", he: "איך קוראים לך ביום־יום?" }, placeholder: { en: "Nickname", he: "כינוי" } },
  country: { section: 0, kind: "text", field: "country", title: { en: "Where in the world are you?", he: "מאיפה בעולם?" }, placeholder: { en: "Country", he: "מדינה" } },
  age_band: {
    section: 0, kind: "single", field: "band", title: { en: "What's your age range?", he: "מה טווח הגיל שלך?" },
    options: [o("18-24", "18–24", "18–24"), o("25-34", "25–34", "25–34"), o("35-44", "35–44", "35–44"), o("45-54", "45–54", "45–54"),
      o("55-64", "55–64", "55–64"), o("65+", "65+", "65+"), o("prefer_not", "Prefer not to say", "מעדיף/ה לא לומר")],
  },
  genres: {
    section: 1, kind: "custom", title: { en: "What's usually playing in your headphones?", he: "מה בדרך כלל מתנגן אצלך באוזניות?" }, max: 3,
    options: [o("pop", "Pop", "פופ"), o("rnb", "R&B", "R&B"), o("hiphop", "Hip hop", "היפ הופ"), o("electronic", "Electronic", "אלקטרוני"),
      o("rock", "Rock", "רוק"), o("indie", "Indie", "אינדי"), o("jazz", "Jazz", "ג׳אז"), o("classical", "Classical", "קלאסי"),
      o("latin", "Latin", "לטיני"), o("mizrahi", "Mizrahi", "מזרחית"), o("folk", "Folk", "פולק"), o("lofi", "Lo-fi", "לו־פיי")],
  },
  song_language: {
    section: 1, kind: "multi", field: "languages", max: 3, title: { en: "Which language do you most enjoy hearing music in?", he: "באיזו שפה הכי כיף לך לשמוע מוזיקה?" },
    options: [o("en", "English", "אנגלית"), o("he", "Hebrew", "עברית"), o("es", "Spanish", "ספרדית"), o("fr", "French", "צרפתית"),
      o("ar", "Arabic", "ערבית"), o("mixed", "Mixed", "מעורב"), o("instrumental", "Instrumental", "אינסטרומנטלי")],
  },
  moments: {
    section: 1, kind: "multi", field: "moments", max: 3, title: { en: "Where does music catch you on a normal day?", he: "איפה המוזיקה תופסת אותך ביום רגיל?" },
    options: [o("drive", "Driving", "בנהיגה"), o("work", "Working", "בעבודה"), o("workout", "Workout", "באימון"), o("walking", "Walking", "בהליכה"),
      o("home", "At home", "בבית"), o("winding_down", "Winding down", "בסוף היום")],
  },
  relationship: {
    section: 2, kind: "custom", field: "status", title: { en: "What's your relationship status?", he: "מה הסטטוס הזוגי שלך?" },
    options: [o("single", "Single", "רווק/ה"), o("partnered", "In a relationship", "בזוגיות"), o("married", "Married", "נשוי/אה"), o("other", "Other", "אחר")],
  },
  children: { section: 2, kind: "custom", title: { en: "Any kids at home?", he: "יש ילדים בבית?" } },
  pet: {
    section: 2, kind: "custom", field: "status", title: { en: "Do you have — or did you have — a pet?", he: "יש או הייתה לך חיית מחמד?" },
    options: [o("now", "Yes, now", "כן, עכשיו"), o("past", "In the past", "בעבר"), o("no", "No", "לא")],
  },
  hobby: {
    section: 2, kind: "custom", max: 3, title: { en: "What's the most fun way to spend a free hour?", he: "מה הכי כיף לך לעשות בשעה פנויה?" },
    options: [o("cooking", "Cooking", "בישול"), o("sports", "Sports", "ספורט"), o("reading", "Reading", "קריאה"), o("gaming", "Gaming", "גיימינג"),
      o("travel", "Travel", "טיולים"), o("art", "Art", "אמנות"), o("gardening", "Gardening", "גינון"), o("music", "Making music", "מוזיקה"),
      o("outdoors", "Outdoors", "טבע"), o("friends", "Friends", "חברים")],
  },
  work: {
    section: 2, kind: "custom", field: "field", title: { en: "What fills most of your working day?", he: "במה עובר רוב יום העבודה שלך?" },
    options: [o("tech", "Tech", "הייטק"), o("health", "Health", "בריאות"), o("education", "Education", "חינוך"), o("creative", "Creative", "יצירה"),
      o("trades", "Trades", "מקצועות כפיים"), o("business", "Business", "עסקים"), o("service", "Service", "שירות"), o("studying", "Studying", "לימודים"),
      o("caregiving", "Caregiving", "טיפול במשפחה"), o("other", "Other", "אחר")],
  },
  upcoming_event: {
    section: 2, kind: "custom", field: "kind", title: { en: "Anything happy coming up soon?", he: "יש משהו שמח שמחכים לו בקרוב?" },
    options: [o("trip", "A trip", "טיול"), o("birthday", "A birthday", "יום הולדת"), o("celebration", "A celebration", "חגיגה"),
      o("new_beginning", "A new beginning", "התחלה חדשה"), o("none", "Nothing special", "שום דבר מיוחד")],
  },
  fu_baby_word: { section: 2, kind: "custom", title: { en: "What word or sound do you hear at home again and again?", he: "איזו מילה או איזה צליל שומעים אצלכם שוב ושוב?" } },
  fu_pet_joy: {
    section: 2, kind: "custom",
    title: ({ petName }) => ({ en: `What always makes ${petName || "your pet"} happy?`, he: `מה תמיד משמח את ${petName || "חיית המחמד"}?` }),
  },
  fu_past_pet_moment: { section: 2, kind: "custom", title: { en: "Which small moment do you especially remember?", he: "איזה רגע קטן זכור לך במיוחד?" } },
  fu_partner_phrase: { section: 2, kind: "custom", title: { en: "Is there a phrase only the two of you understand?", he: "יש משפט שרק שניכם מבינים?" } },
};

export const FOLLOWUP_CHIP_OPTS: Opt[] = [o("food", "Food", "אוכל"), o("color", "A color", "צבע"), o("activity", "An activity", "פעילות")];
export const SPECIES: Opt[] = [o("dog", "Dog", "כלב"), o("cat", "Cat", "חתול"), o("bird", "Bird", "ציפור"), o("fish", "Fish", "דג"), o("rabbit", "Rabbit", "ארנב"), o("other", "Other", "אחר")];
export const CHILD_AGES: Opt[] = [o("baby", "Baby", "תינוק/ת"), o("toddler", "Toddler", "פעוט/ה"), o("older", "Older", "גדולים יותר")];
