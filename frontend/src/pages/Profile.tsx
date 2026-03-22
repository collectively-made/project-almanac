import { useEffect, useState } from "react";

interface ProfileData {
  state?: string;
  region_description?: string;
  dwelling?: string;
  property_size?: string;
  setting?: string;
  household_size?: number;
  children?: string;
  pets?: string;
  medical_needs?: string;
  water_source?: string;
  heating?: string;
  power?: string;
  has_garden?: boolean;
  garden_size?: string;
  livestock?: string;
  food_storage?: string;
  experience_level?: string;
  priorities?: string;
  notes?: string;
}

interface ProfileProps {
  onBack: () => void;
}

const QUESTIONS: {
  key: keyof ProfileData;
  label: string;
  type: "text" | "select" | "number" | "boolean";
  placeholder?: string;
  options?: string[];
  group: string;
}[] = [
  { key: "region_description", label: "Where do you live?", type: "text", placeholder: "e.g. rural Minnesota, apartment in Birmingham AL, suburban Denver", group: "Location" },
  { key: "dwelling", label: "Type of home", type: "select", options: ["house", "apartment", "mobile home", "cabin", "RV", "homestead"], group: "Location" },
  { key: "setting", label: "Setting", type: "select", options: ["rural", "suburban", "urban"], group: "Location" },
  { key: "property_size", label: "Property size", type: "text", placeholder: "e.g. balcony only, 1/4 acre, 5 acres", group: "Location" },

  { key: "household_size", label: "People in household", type: "number", placeholder: "4", group: "Household" },
  { key: "children", label: "Children", type: "text", placeholder: "e.g. none, 2 kids under 10", group: "Household" },
  { key: "pets", label: "Pets", type: "text", placeholder: "e.g. 2 dogs, 3 cats", group: "Household" },
  { key: "medical_needs", label: "Medical considerations", type: "text", placeholder: "e.g. diabetic family member, allergies", group: "Household" },

  { key: "water_source", label: "Water source", type: "select", options: ["municipal", "well", "spring", "rainwater", "unknown"], group: "Infrastructure" },
  { key: "heating", label: "Primary heating", type: "select", options: ["electric", "natural gas", "propane", "wood stove", "oil", "heat pump"], group: "Infrastructure" },
  { key: "power", label: "Power situation", type: "select", options: ["grid only", "grid + solar", "grid + generator", "off-grid solar", "off-grid generator"], group: "Infrastructure" },

  { key: "has_garden", label: "Do you have a garden?", type: "boolean", group: "Food Production" },
  { key: "garden_size", label: "Garden size", type: "text", placeholder: "e.g. container only, raised beds, 1/4 acre", group: "Food Production" },
  { key: "livestock", label: "Livestock", type: "text", placeholder: "e.g. chickens, goats, none", group: "Food Production" },
  { key: "food_storage", label: "Current food storage", type: "select", options: ["minimal (few days)", "basic pantry (1-2 weeks)", "1 month supply", "3+ month supply", "6+ month supply"], group: "Food Production" },

  { key: "experience_level", label: "Experience level", type: "select", options: ["beginner", "some experience", "intermediate", "experienced", "expert"], group: "About You" },
  { key: "priorities", label: "What are you focused on?", type: "text", placeholder: "e.g. food self-sufficiency, general preparedness, off-grid transition", group: "About You" },
  { key: "notes", label: "Anything else we should know?", type: "text", placeholder: "e.g. specific skills, concerns, plans", group: "About You" },
];

export function Profile({ onBack }: ProfileProps) {
  const [profile, setProfile] = useState<ProfileData>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/context/profile")
      .then((r) => r.json())
      .then((data) => setProfile(data))
      .catch(() => {});
  }, []);

  const handleChange = (key: keyof ProfileData, value: string | number | boolean) => {
    setProfile((p) => ({ ...p, [key]: value || undefined }));
    setSaved(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/context/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      setSaved(true);
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const groups = [...new Set(QUESTIONS.map((q) => q.group))];

  return (
    <div className="profile-page">
      <div className="profile-inner">
        <div className="profile-header">
          <button onClick={onBack} className="profile-back" aria-label="Back">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M10 3L5 8l5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
          <div>
            <h1 className="profile-title">YOUR PROFILE</h1>
            <p className="profile-sub">Help Almanac give you personalized answers</p>
          </div>
        </div>

        <p className="profile-intro">
          Everything here is optional and stored only on your device. The more context you provide,
          the more relevant your answers will be. For example, knowing your location helps with
          planting schedules, climate-appropriate advice, and region-specific recommendations.
        </p>

        {groups.map((group) => (
          <div key={group} className="profile-group">
            <div className="profile-group-label">{group}</div>
            {QUESTIONS.filter((q) => q.group === group).map((q) => (
              <div key={q.key} className="profile-field">
                <label className="field-label">{q.label}</label>
                {q.type === "select" ? (
                  <select
                    className="field-input field-select"
                    value={(profile[q.key] as string) || ""}
                    onChange={(e) => handleChange(q.key, e.target.value)}
                  >
                    <option value="">—</option>
                    {q.options?.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : q.type === "boolean" ? (
                  <div className="field-toggle">
                    <button
                      className={`toggle-btn ${profile[q.key] === true ? "active" : ""}`}
                      onClick={() => handleChange(q.key, true)}
                    >Yes</button>
                    <button
                      className={`toggle-btn ${profile[q.key] === false ? "active" : ""}`}
                      onClick={() => handleChange(q.key, false)}
                    >No</button>
                  </div>
                ) : q.type === "number" ? (
                  <input
                    type="number"
                    className="field-input"
                    value={(profile[q.key] as number) || ""}
                    placeholder={q.placeholder}
                    onChange={(e) => handleChange(q.key, parseInt(e.target.value) || 0)}
                    min={0}
                  />
                ) : (
                  <input
                    type="text"
                    className="field-input"
                    value={(profile[q.key] as string) || ""}
                    placeholder={q.placeholder}
                    onChange={(e) => handleChange(q.key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        ))}

        <div className="profile-actions">
          <button className="profile-save" onClick={handleSave} disabled={saving}>
            {saving ? "Saving..." : saved ? "Saved" : "Save Profile"}
          </button>
          {saved && <span className="save-confirm">Your profile will personalize all future responses.</span>}
        </div>
      </div>

      <style>{`
        .profile-page {
          min-height: 100vh;
          padding: 24px;
          animation: fadeInUp 0.3s ease;
        }
        .profile-inner {
          max-width: 520px;
          margin: 0 auto;
        }
        .profile-header {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 16px;
        }
        .profile-back {
          width: 32px; height: 32px;
          display: flex; align-items: center; justify-content: center;
          background: var(--bg-elevated); color: var(--text-muted);
          border: 1px solid var(--border); border-radius: 6px;
          cursor: pointer; transition: all 0.15s; flex-shrink: 0;
        }
        .profile-back:hover { color: var(--text); border-color: var(--border-light); }
        .profile-title {
          font-family: var(--font-mono); font-size: 13px; font-weight: 500;
          letter-spacing: 0.14em; color: var(--text);
        }
        .profile-sub {
          font-size: 12px; color: var(--text-muted); margin-top: 1px;
        }
        .profile-intro {
          font-size: 13px; color: var(--text-muted); line-height: 1.6;
          margin-bottom: 24px;
        }
        .profile-group {
          margin-bottom: 20px;
        }
        .profile-group-label {
          font-family: var(--font-mono); font-size: 9.5px; font-weight: 500;
          color: var(--text-dim); letter-spacing: 0.14em;
          margin-bottom: 10px; padding-bottom: 6px;
          border-bottom: 1px solid var(--border);
          text-transform: uppercase;
        }
        .profile-field {
          margin-bottom: 12px;
        }
        .field-label {
          display: block; font-size: 13px; color: var(--text);
          margin-bottom: 4px; font-weight: 500;
        }
        .field-input {
          width: 100%; padding: 8px 12px;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 6px; color: var(--text-bright);
          font-family: var(--font-body); font-size: 14px;
          outline: none; transition: border-color 0.15s;
        }
        .field-input:focus { border-color: var(--accent); }
        .field-input::placeholder { color: var(--text-dim); }
        .field-select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg width='10' height='6' viewBox='0 0 10 6' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%237a756a' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 12px center;
          padding-right: 32px;
        }
        .field-toggle {
          display: flex; gap: 4px;
        }
        .toggle-btn {
          padding: 6px 16px;
          background: var(--bg-input); border: 1px solid var(--border);
          border-radius: 6px; color: var(--text-muted);
          font-size: 13px; cursor: pointer; transition: all 0.15s;
          font-family: var(--font-body);
        }
        .toggle-btn.active {
          background: var(--accent-dim); border-color: var(--accent);
          color: var(--accent);
        }
        .profile-actions {
          display: flex; flex-direction: column; gap: 8px;
          margin-top: 8px; padding-top: 16px;
          border-top: 1px solid var(--border);
        }
        .profile-save {
          width: 100%; padding: 10px;
          background: var(--accent); color: var(--bg);
          border: none; border-radius: 8px;
          font-family: var(--font-body); font-size: 14px; font-weight: 600;
          cursor: pointer; transition: filter 0.15s;
        }
        .profile-save:hover { filter: brightness(1.1); }
        .profile-save:disabled { opacity: 0.6; }
        .save-confirm {
          font-size: 12px; color: var(--sage-bright); text-align: center;
        }
      `}</style>
    </div>
  );
}
