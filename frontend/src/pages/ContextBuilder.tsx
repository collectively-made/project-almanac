import { useEffect, useRef, useState } from "react";

interface ContextBuilderProps {
  onDone: () => void;
}

interface Step {
  id: string;
  question: string;
  type: "choice" | "text" | "rank";
  options?: string[];
  field: string; // maps to profile field
  followUp?: string; // follow-up question for "other"
}

const STEPS: Step[] = [
  {
    id: "location",
    question: "Let's start with where you are. What best describes your location?",
    type: "text",
    field: "region_description",
    followUp: "Tell me your city/state, or describe your area (e.g. 'rural Vermont', 'suburban Phoenix')",
  },
  {
    id: "dwelling",
    question: "What kind of home do you live in?",
    type: "choice",
    options: ["House with land", "House (small lot)", "Apartment / condo", "Mobile home", "Cabin / rural property", "RV / van"],
    field: "dwelling",
  },
  {
    id: "setting",
    question: "How would you describe your area?",
    type: "choice",
    options: ["Rural", "Suburban", "Urban"],
    field: "setting",
  },
  {
    id: "household",
    question: "How many people are in your household?",
    type: "choice",
    options: ["Just me", "2 people", "3-4 people", "5+ people"],
    field: "household_size",
  },
  {
    id: "water",
    question: "Where does your water come from?",
    type: "choice",
    options: ["City / municipal water", "Well", "Spring", "Rainwater collection", "Not sure"],
    field: "water_source",
  },
  {
    id: "power",
    question: "What's your power situation?",
    type: "choice",
    options: ["Grid power only", "Grid + solar panels", "Grid + generator backup", "Off-grid solar", "Off-grid generator"],
    field: "power",
  },
  {
    id: "garden",
    question: "Do you grow any of your own food?",
    type: "choice",
    options: ["Yes, I have a garden", "Small container garden / balcony", "Not yet, but I want to", "No, and I don't plan to"],
    field: "has_garden",
  },
  {
    id: "food_storage",
    question: "How much food do you typically keep on hand?",
    type: "choice",
    options: ["A few days worth", "1-2 weeks (basic pantry)", "About a month", "3+ months", "6+ months"],
    field: "food_storage",
  },
  {
    id: "experience",
    question: "How would you rate your homesteading / preparedness experience?",
    type: "choice",
    options: ["Complete beginner — just getting started", "Some experience — I've done a few things", "Intermediate — comfortable with the basics", "Experienced — I've been at this for years"],
    field: "experience_level",
  },
  {
    id: "priorities",
    question: "What's your main focus right now? Pick whatever resonates most.",
    type: "choice",
    options: ["General emergency preparedness", "Growing and preserving food", "Energy independence / off-grid", "Building self-sufficiency skills", "Preparing for specific threats", "Just learning and exploring"],
    field: "priorities",
  },
];

interface Message {
  role: "system" | "user";
  content: string;
  options?: string[];
  type?: "choice" | "text" | "rank";
  stepId?: string;
}

export function ContextBuilder({ onDone }: ContextBuilderProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [textInput, setTextInput] = useState("");
  const [profile, setProfile] = useState<Record<string, string | number | boolean>>({});
  const [saving, setSaving] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Start with intro + first question
    setMessages([
      {
        role: "system",
        content: "I'll ask you a few quick questions to personalize your Almanac experience. Everything is stored locally on your device — nothing leaves your network. You can skip any question or update your answers later.",
      },
      {
        role: "system",
        content: STEPS[0].question,
        options: STEPS[0].options,
        type: STEPS[0].type,
        stepId: STEPS[0].id,
      },
    ]);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleAnswer = (answer: string) => {
    const step = STEPS[currentStep];

    // Map answer to profile field
    const profileUpdate = { ...profile };
    if (step.field === "household_size") {
      const num = answer.startsWith("Just") ? 1 : parseInt(answer) || 4;
      profileUpdate[step.field] = num;
    } else if (step.field === "has_garden") {
      profileUpdate[step.field] = answer.startsWith("Yes");
      if (answer.includes("container") || answer.includes("balcony")) {
        profileUpdate["garden_size"] = "container only";
        profileUpdate[step.field] = true;
      }
    } else if (step.field === "dwelling") {
      const map: Record<string, string> = {
        "House with land": "house",
        "House (small lot)": "house",
        "Apartment / condo": "apartment",
        "Mobile home": "mobile home",
        "Cabin / rural property": "cabin",
        "RV / van": "RV",
      };
      profileUpdate[step.field] = map[answer] || answer.toLowerCase();
      if (answer.includes("land") || answer.includes("rural")) {
        profileUpdate["property_size"] = "acreage";
      }
    } else if (step.field === "water_source") {
      const map: Record<string, string> = {
        "City / municipal water": "municipal",
        "Well": "well", "Spring": "spring",
        "Rainwater collection": "rainwater",
        "Not sure": "unknown",
      };
      profileUpdate[step.field] = map[answer] || answer;
    } else {
      profileUpdate[step.field] = answer;
    }
    setProfile(profileUpdate);

    // Add user's answer to messages
    setMessages((prev) => [...prev, { role: "user", content: answer }]);

    const nextStep = currentStep + 1;
    if (nextStep < STEPS.length) {
      // Ask next question after a brief delay
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: STEPS[nextStep].question,
            options: STEPS[nextStep].options,
            type: STEPS[nextStep].type,
            stepId: STEPS[nextStep].id,
          },
        ]);
        setCurrentStep(nextStep);
      }, 400);
    } else {
      // Done — save and show summary
      setTimeout(() => {
        handleComplete(profileUpdate);
      }, 400);
    }
  };

  const handleComplete = async (finalProfile: Record<string, string | number | boolean>) => {
    setSaving(true);
    setMessages((prev) => [
      ...prev,
      {
        role: "system",
        content: "Great — I've saved your profile. Your answers will personalize every response from now on. You can update these anytime from the profile button in the header.",
      },
    ]);

    try {
      await fetch("/api/context/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(finalProfile),
      });
    } catch {
      // silent
    }

    setSaving(false);
    setTimeout(onDone, 2000);
  };

  const handleSkip = () => {
    setMessages((prev) => [...prev, { role: "user", content: "Skip" }]);
    const nextStep = currentStep + 1;
    if (nextStep < STEPS.length) {
      setTimeout(() => {
        setMessages((prev) => [
          ...prev,
          {
            role: "system",
            content: STEPS[nextStep].question,
            options: STEPS[nextStep].options,
            type: STEPS[nextStep].type,
            stepId: STEPS[nextStep].id,
          },
        ]);
        setCurrentStep(nextStep);
      }, 300);
    } else {
      handleComplete(profile);
    }
  };

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    handleAnswer(textInput.trim());
    setTextInput("");
  };

  const lastMessage = messages[messages.length - 1];
  const isWaitingForInput = lastMessage?.role === "system" && lastMessage?.type && !saving;
  const progress = Math.round((currentStep / STEPS.length) * 100);

  return (
    <div className="cb-page">
      <div className="cb-container">
        {/* Header */}
        <div className="cb-header">
          <div className="cb-header-left">
            <div className="cb-mark" />
            <div>
              <h1 className="cb-title">PERSONALIZE ALMANAC</h1>
              <p className="cb-sub">All answers stored locally on your device</p>
            </div>
          </div>
          <button className="cb-skip-all" onClick={() => handleComplete(profile)}>
            {currentStep > 2 ? "Finish early" : "Skip all"}
          </button>
        </div>

        {/* Progress bar */}
        <div className="cb-progress-track">
          <div className="cb-progress-fill" style={{ width: `${progress}%` }} />
        </div>

        {/* Messages */}
        <div className="cb-messages" ref={scrollRef}>
          {messages.map((msg, i) => (
            <div key={i} className={`cb-msg ${msg.role === "user" ? "cb-msg-user" : "cb-msg-system"}`}>
              {msg.role === "system" && (
                <div className="cb-msg-dot" />
              )}
              <div className="cb-msg-content">
                <p>{msg.content}</p>
                {/* Choice options */}
                {msg.options && msg.role === "system" && i === messages.length - 1 && isWaitingForInput && (
                  <div className="cb-options">
                    {msg.options.map((opt) => (
                      <button
                        key={opt}
                        className="cb-option"
                        onClick={() => handleAnswer(opt)}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Text input for text-type questions */}
        {isWaitingForInput && lastMessage?.type === "text" && (
          <div className="cb-input-area">
            <form onSubmit={(e) => { e.preventDefault(); handleTextSubmit(); }} className="cb-input-form">
              <input
                type="text"
                className="cb-input"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                placeholder={STEPS[currentStep]?.followUp || "Type your answer..."}
                autoFocus
              />
              <button type="submit" className="cb-input-send" disabled={!textInput.trim()}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </form>
            <button className="cb-text-skip" onClick={handleSkip}>Skip this question</button>
          </div>
        )}

        {/* Skip for choice questions */}
        {isWaitingForInput && lastMessage?.type === "choice" && (
          <div className="cb-input-area">
            <button className="cb-text-skip" onClick={handleSkip}>Skip this question</button>
          </div>
        )}
      </div>

      <style>{`
        .cb-page {
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          padding: 24px;
          animation: fadeInUp 0.4s ease;
        }
        .cb-container {
          max-width: 520px;
          width: 100%;
          max-height: 90vh;
          display: flex;
          flex-direction: column;
          background: var(--bg-elevated);
          border: 1px solid var(--border);
          border-radius: 10px;
          overflow: hidden;
        }
        .cb-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 16px 20px;
          border-bottom: 1px solid var(--border);
          flex-shrink: 0;
        }
        .cb-header-left {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .cb-mark {
          width: 4px;
          height: 24px;
          background: var(--accent);
          border-radius: 2px;
          flex-shrink: 0;
        }
        .cb-title {
          font-family: var(--font-mono);
          font-size: 12px;
          font-weight: 500;
          letter-spacing: 0.12em;
          color: var(--text);
        }
        .cb-sub {
          font-size: 11px;
          color: var(--text-muted);
          margin-top: 1px;
        }
        .cb-skip-all {
          font-family: var(--font-mono);
          font-size: 11px;
          color: var(--text-dim);
          background: none;
          border: 1px solid var(--border);
          border-radius: 4px;
          padding: 4px 10px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .cb-skip-all:hover {
          color: var(--text-muted);
          border-color: var(--border-light);
        }

        /* Progress */
        .cb-progress-track {
          height: 2px;
          background: var(--border);
          flex-shrink: 0;
        }
        .cb-progress-fill {
          height: 100%;
          background: var(--accent);
          transition: width 0.4s ease;
        }

        /* Messages */
        .cb-messages {
          flex: 1;
          overflow-y: auto;
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .cb-msg {
          display: flex;
          gap: 10px;
          animation: fadeInUp 0.25s ease;
        }
        .cb-msg-user {
          justify-content: flex-end;
          padding-left: 40px;
        }
        .cb-msg-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--sage);
          margin-top: 7px;
          flex-shrink: 0;
        }
        .cb-msg-content {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .cb-msg-content p {
          font-size: 14px;
          line-height: 1.6;
          color: var(--text);
        }
        .cb-msg-user .cb-msg-content p {
          background: var(--bg-card);
          border: 1px solid var(--border);
          border-radius: 8px 2px 8px 8px;
          padding: 8px 14px;
          color: var(--text-bright);
          font-size: 13.5px;
        }

        /* Choice options */
        .cb-options {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .cb-option {
          text-align: left;
          padding: 10px 14px;
          background: var(--bg);
          border: 1px solid var(--border);
          border-radius: 8px;
          color: var(--text-muted);
          font-family: var(--font-body);
          font-size: 13.5px;
          cursor: pointer;
          transition: all 0.15s;
          line-height: 1.4;
        }
        .cb-option:hover {
          border-color: var(--accent);
          color: var(--text);
          background: var(--accent-dim);
        }

        /* Input area */
        .cb-input-area {
          padding: 12px 20px 16px;
          border-top: 1px solid var(--border);
          flex-shrink: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .cb-input-form {
          display: flex;
          gap: 6px;
        }
        .cb-input {
          flex: 1;
          padding: 9px 14px;
          background: var(--bg-input);
          border: 1px solid var(--border);
          border-radius: 6px;
          color: var(--text-bright);
          font-family: var(--font-body);
          font-size: 14px;
          outline: none;
          transition: border-color 0.15s;
        }
        .cb-input:focus { border-color: var(--accent); }
        .cb-input::placeholder { color: var(--text-dim); }
        .cb-input-send {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--accent);
          color: var(--bg);
          border: none;
          border-radius: 6px;
          cursor: pointer;
          flex-shrink: 0;
        }
        .cb-input-send:disabled {
          background: var(--border);
          color: var(--text-dim);
          cursor: default;
        }
        .cb-text-skip {
          background: none;
          border: none;
          color: var(--text-dim);
          font-size: 12px;
          cursor: pointer;
          text-align: center;
          padding: 2px;
          font-family: var(--font-mono);
        }
        .cb-text-skip:hover { color: var(--text-muted); }
      `}</style>
    </div>
  );
}
