import { useState } from 'react';
import { useRouter } from 'next/router';
import { motion } from 'framer-motion';
import { PaperAirplaneIcon, MapPinIcon, CalendarIcon, UsersIcon } from '@heroicons/react/24/outline';
import toast, { Toaster } from 'react-hot-toast';
import axios from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api/v1';

export default function Home() {
  const [inputText, setInputText] = useState('');
  const [loading, setLoading] = useState(false);
  const [trip, setTrip] = useState(null);
  const [currentStep, setCurrentStep] = useState('input'); // input, questions, itinerary
  const [draft, setDraft] = useState<any>(null); // parsed fields waiting user confirmation

  const [chatOpen, setChatOpen] = useState(false);

  // Util: normalize various date strings to ISO YYYY-MM-DD and fix past year -> current year
  const normalizeISODate = (val?: string | null) => {
    if (!val || typeof val !== 'string') return val;
    let s = val.trim();
    // Convert dd-mm-yyyy to yyyy-mm-dd
    const dmy = s.match(/^(\d{2})[-\/.](\d{2})[-\/.](\d{4})$/);
    if (dmy) {
      s = `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
    }
    // Already ISO?
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) {
      const year = parseInt(iso[1], 10);
      const month = parseInt(iso[2], 10) - 1;
      const day = parseInt(iso[3], 10);
      const nowY = new Date().getFullYear();
      const dt = new Date(year, month, day);
      if (year < nowY) {
        const fixed = new Date(nowY, month, day);
        return fixed.toISOString().split('T')[0];
      }
      return dt.toISOString().split('T')[0];
    }
    // Try parsing natural date
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) {
      const nowY = new Date().getFullYear();
      let y = dt.getFullYear();
      if (y < nowY) y = nowY;
      const fixed = new Date(y, dt.getMonth(), dt.getDate());
      return fixed.toISOString().split('T')[0];
    }
    return s;
  };

  

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    setLoading(true);
    try {
      // 1) Parse intent from free text
      const parseRes = await axios.post(`${API_BASE_URL}/intent/parse`, { text: inputText }, {
        headers: { 'x-user-id': 'demo-user-123', 'Content-Type': 'application/json' }
      });
      const parsed = parseRes.data?.parsed || {};
      // Normalize dates immediately to ISO and current year
      if (parsed.start_date) parsed.start_date = normalizeISODate(parsed.start_date);
      if (parsed.end_date) parsed.end_date = normalizeISODate(parsed.end_date);

      // If basic essentials are missing, ask user to confirm them first
      const needsDates = !(parsed.start_date && parsed.end_date) && !parsed.duration_days;
      const needsBudget = !parsed.budget_per_person;
      if (needsDates || needsBudget) {
        setDraft({
          destination: parsed.destination || 'Goa',
          party_size: parsed.party_size || 2,
          trip_type: parsed.trip_type || 'family',
          interests: parsed.interests || [],
          start_date: parsed.start_date || '',
          end_date: parsed.end_date || '',
          duration_days: parsed.duration_days || 2,
          budget_per_person: parsed.budget_per_person || 5000,
          input_text: inputText,
        });
        toast('Please confirm basics to continue');
        return; // wait for confirmation submit
      }

      // 2) Create trip with parsed basics
      const tripRes = await axios.post(`${API_BASE_URL}/trips`, {
        destination: parsed.destination || 'Goa',
        input_text: inputText,
        party_size: parsed.party_size || 2,
        trip_type: parsed.trip_type || 'family',
        budget_per_person: parsed.budget_per_person || 5000
      }, {
        headers: { 'x-user-id': 'demo-user-123', 'Content-Type': 'application/json' }
      });
      const createdTrip = tripRes.data;

      // 3) Auto-submit answers (dates, interests)
      const answers: any = {};
      if (parsed.start_date) answers.start_date = parsed.start_date;
      if (parsed.end_date) answers.end_date = parsed.end_date;
      if (parsed.duration_days) answers.duration = parsed.duration_days; // backend will recompute if dates present
      if (parsed.interests && parsed.interests.length) answers.interests = parsed.interests;

      if (Object.keys(answers).length > 0) {
        await axios.post(`${API_BASE_URL}/trips/${createdTrip.id}/answers`, { answers }, {
          headers: { 'x-user-id': 'demo-user-123', 'Content-Type': 'application/json' }
        });
      }

      // 4) Fetch itinerary immediately
      const itineraryRes = await axios.get(`${API_BASE_URL}/trips/${createdTrip.id}/itinerary`, {
        headers: { 'x-user-id': 'demo-user-123' }
      });
      setTrip({ ...createdTrip, itinerary: itineraryRes.data });
      setCurrentStep('itinerary');
      toast.success('Your itinerary is ready!');
    } catch (error) {
      console.error('Error creating trip:', error);
      toast.error('Failed to create trip. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmBasics = async () => {
    if (!draft) return;
    setLoading(true);
    try {
      // Create trip from draft
      const tripRes = await axios.post(`${API_BASE_URL}/trips`, {
        destination: draft.destination,
        input_text: draft.input_text,
        party_size: draft.party_size,
        trip_type: draft.trip_type,
        budget_per_person: draft.budget_per_person
      }, { headers: { 'x-user-id': 'demo-user-123', 'Content-Type': 'application/json' } });
      const createdTrip = tripRes.data;

      // Build answers
      const answers: any = {};
      if (draft.start_date) answers.start_date = draft.start_date;
      if (draft.end_date) answers.end_date = draft.end_date;
      if (!answers.start_date || !answers.end_date) {
        if (draft.duration_days) answers.duration = draft.duration_days;
      }
      if (draft.interests?.length) answers.interests = draft.interests;

      if (Object.keys(answers).length > 0) {
        await axios.post(`${API_BASE_URL}/trips/${createdTrip.id}/answers`, { answers }, {
          headers: { 'x-user-id': 'demo-user-123', 'Content-Type': 'application/json' }
        });
      }

      const itineraryRes = await axios.get(`${API_BASE_URL}/trips/${createdTrip.id}/itinerary`, {
        headers: { 'x-user-id': 'demo-user-123' }
      });
      setTrip({ ...createdTrip, itinerary: itineraryRes.data });
      setCurrentStep('itinerary');
      setDraft(null);
      toast.success('Your itinerary is ready!');
    } catch (e) {
      console.error(e);
      toast.error('Failed to create trip');
    } finally {
      setLoading(false);
    }
  };

  const handleAnswerSubmit = async (answers: any) => {
    if (!trip) return;

    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/trips/${trip.id}/answers`, {
        answers
      }, {
        headers: {
          'x-user-id': 'demo-user-123',
          'Content-Type': 'application/json'
        }
      });

      if (response.data.questionnaire_complete) {
        // Fetch itinerary
        const itineraryResponse = await axios.get(`${API_BASE_URL}/trips/${trip.id}/itinerary`, {
          headers: { 'x-user-id': 'demo-user-123' }
        });
        
        setTrip({ ...trip, itinerary: itineraryResponse.data });
        setCurrentStep('itinerary');
        toast.success('Your personalized itinerary is ready!');
      } else {
        setTrip({ ...trip, next_questions: response.data.next_questions });
        toast.success('Great! A few more questions to perfect your trip.');
      }
    } catch (error) {
      console.error('Error submitting answers:', error);
      toast.error('Failed to submit answers. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-100 via-amber-50 to-orange-100 relative overflow-x-hidden">
      {/* Decorative beach waves background */}
      <div className="pointer-events-none select-none fixed inset-0 -z-10 opacity-50">
        <img src="/beach-waves.svg" alt="beach waves" className="w-full h-full object-cover" />
      </div>
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="bg-white/80 backdrop-blur shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <MapPinIcon className="h-8 w-8 text-orange-500" />
              <h1 className="text-2xl font-bold text-gray-900">GoaGuide</h1>
            </div>
            <div className="text-sm text-gray-600">
              Your AI-powered Goa travel companion
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {currentStep === 'input' && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center"
          >
            <div className="mb-8">
              <h2 className="text-4xl font-extrabold text-gray-900 mb-3">
                Sun, Sand, and Smarter Plans ☀️🌊
              </h2>
              <p className="text-lg text-gray-700 max-w-2xl mx-auto">
                Tell us your vibe and budget — we’ll craft a Goa itinerary with beach-friendly pacing, hidden gems, and live tips.
              </p>
            </div>

            <form onSubmit={handleCreateTrip} className="max-w-2xl mx-auto">
              <div className="relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="e.g., 3 days in Goa this November, ₹7000 pp, beaches + nightlife, 2 people"
                  className="w-full p-6 text-lg border-2 border-amber-200 rounded-2xl focus:border-orange-500 focus:ring-0 resize-none h-32 shadow-sm"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !inputText.trim()}
                  className="absolute bottom-4 right-4 bg-gradient-to-r from-orange-500 to-pink-500 text-white p-3 rounded-xl hover:from-orange-600 hover:to-pink-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow"
                >
                  {loading ? (
                    <div className="animate-spin h-6 w-6 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <PaperAirplaneIcon className="h-6 w-6" />
                  )}
                </button>
              </div>
            </form>

            {draft && (
              <div className="mt-4 max-w-2xl mx-auto">
                <div className="flex flex-wrap gap-2">
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-50 text-orange-800 border border-orange-200 text-sm">
                    <span className="font-semibold">Dates:</span>
                    {draft.start_date && draft.end_date
                      ? `${new Date(draft.start_date).toLocaleDateString()} → ${new Date(draft.end_date).toLocaleDateString()}`
                      : `${draft.duration_days || 2} days`}
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-800 border border-blue-200 text-sm">
                    <span className="font-semibold">People:</span>
                    {draft.party_size}
                  </span>
                  <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-green-50 text-green-800 border border-green-200 text-sm">
                    <span className="font-semibold">Budget:</span>
                    ₹{(draft.budget_per_person || 0).toLocaleString()}/person
                  </span>
                  {Array.isArray(draft.interests) && draft.interests.length > 0 && (
                    <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-purple-50 text-purple-800 border border-purple-200 text-sm">
                      <span className="font-semibold">Interests:</span>
                      {draft.interests.join(', ')}
                    </span>
                  )}
                </div>
              </div>
            )}

            {draft && (
              <div className="mt-6 max-w-2xl mx-auto text-left bg-white border rounded-xl p-4">
                <h4 className="text-lg font-semibold text-gray-900 mb-3">Confirm basics</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="text-sm text-gray-600">Start date</label>
                    <input type="date" value={draft.start_date}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e)=>setDraft({ ...draft, start_date: e.target.value })}
                      className="w-full p-2 border rounded-lg" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">End date</label>
                    <input type="date" value={draft.end_date}
                      min={new Date().toISOString().split('T')[0]}
                      onChange={(e)=>setDraft({ ...draft, end_date: e.target.value })}
                      className="w-full p-2 border rounded-lg" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">Budget per person (₹)</label>
                    <input type="number" min={1000} step={100} value={draft.budget_per_person}
                      onChange={(e)=>setDraft({ ...draft, budget_per_person: parseInt(e.target.value||'0',10) })}
                      className="w-full p-2 border rounded-lg" />
                  </div>
                  <div>
                    <label className="text-sm text-gray-600">People</label>
                    <input type="number" min={1} value={draft.party_size || ''}
                      onChange={(e)=>setDraft({ ...draft, party_size: parseInt(e.target.value||'0',10) })}
                      className="w-full p-2 border rounded-lg" />
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-sm text-gray-600">Interests (comma separated)</label>
                    <input type="text" value={(Array.isArray(draft.interests)? draft.interests.join(', ') : draft.interests || '')}
                      onChange={(e)=>{
                        const arr = e.target.value.split(',').map(s=>s.trim()).filter(Boolean);
                        setDraft({ ...draft, interests: arr });
                      }}
                      placeholder="e.g., Beaches, Nightlife, Local cuisine"
                      className="w-full p-2 border rounded-lg" />
                  </div>
                </div>
                {/* Past date warning */}
                {(() => {
                  try {
                    const today = new Date();
                    today.setHours(0,0,0,0);
                    const s = draft.start_date ? new Date(draft.start_date) : null;
                    const e = draft.end_date ? new Date(draft.end_date) : null;
                    const isPast = (s && s < today) || (e && e < today);
                    if (isPast) {
                      return (
                        <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3 text-sm">
                          The selected dates are in the past. Please pick future dates to get accurate hotels, events, and activities.
                        </div>
                      );
                    }
                  } catch {}
                  return null;
                })()}

      {/* Stays plan (split stays by region/hub) */}
      {Array.isArray(localItinerary.stays) && localItinerary.stays.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Stays plan</h3>
          <div className="space-y-3">
            {localItinerary.stays.map((s: any, i: number) => (
              <div key={i} className="border rounded-lg p-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <div className="font-semibold text-gray-900">{s.region} · {s.area}</div>
                  <div className="text-sm text-gray-700">{s.nights} night{s.nights>1?'s':''} · {s.checkin} → {s.checkout}</div>
                  <div className="text-xs text-gray-600">{s.rationale}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.deeplinks?.google_hotels && (
                    <a href={s.deeplinks.google_hotels} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-pink-700 border border-pink-300 hover:bg-pink-100">Google Hotels</a>
                  )}
                  {s.deeplinks?.booking && (
                    <a href={s.deeplinks.booking} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-blue-700 border border-blue-300 hover:bg-blue-50">Booking.com</a>
                  )}
                  {s.deeplinks?.mmt && (
                    <a href={s.deeplinks.mmt} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-green-700 border border-green-300 hover:bg-green-50">MakeMyTrip</a>
                  )}
                  {s.deeplinks?.airbnb && (
                    <a href={s.deeplinks.airbnb} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-red-700 border border-red-300 hover:bg-red-50">Airbnb</a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
                <div className="mt-4 flex justify-end gap-3">
                  <button onClick={()=>setDraft(null)} className="px-4 py-2 rounded-lg border">Cancel</button>
                  <button onClick={async ()=>{
                    // Normalize draft dates before submit
                    const norm = {
                      ...draft,
                      start_date: normalizeISODate(draft.start_date),
                      end_date: normalizeISODate(draft.end_date),
                    };
                    setDraft(norm);
                    await handleConfirmBasics();
                  }} disabled={loading} className="px-4 py-2 rounded-lg bg-orange-500 text-white">Continue</button>
                </div>
              </div>
            )}

            <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-6">
              <FeatureCard
                icon={<MapPinIcon className="h-8 w-8 text-orange-500" />}
                title="Smart Itinerary"
                description="AI-powered planning with real-time weather and traffic data"
              />
              <FeatureCard
                icon={<CalendarIcon className="h-8 w-8 text-blue-500" />}
                title="Budget Optimized"
                description="Get the best value for your money with cost-first optimization"
              />
              <FeatureCard
                icon={<UsersIcon className="h-8 w-8 text-green-500" />}
                title="Local Events"
                description="Discover festivals, markets, and hidden gems happening during your visit"
              />
            </div>
          </motion.div>
        )}

        {currentStep === 'questions' && trip && (
          <QuestionsStep 
            trip={trip} 
            onSubmit={handleAnswerSubmit} 
            loading={loading} 
          />
        )}

        {currentStep === 'itinerary' && trip?.itinerary && (
          <ItineraryStep itinerary={trip.itinerary} />
        )}
      </main>

      {/* Floating Chat Button */}
      <button
        onClick={() => setChatOpen(true)}
        className="fixed bottom-6 right-6 z-40 rounded-full bg-gradient-to-r from-orange-500 to-pink-500 text-white shadow-lg px-4 py-3 font-semibold hover:from-orange-600 hover:to-pink-600"
      >
        Ask GoaGuide AI
      </button>

      {chatOpen && (
        <ChatCoach
          onClose={() => setChatOpen(false)}
          onApplyParsed={(parsed:any)=>{
            const normalizedParsed = {
              ...parsed,
              start_date: normalizeISODate(parsed.start_date),
              end_date: normalizeISODate(parsed.end_date),
            };
            setDraft((prev:any)=>({ ...(prev||{}), ...normalizedParsed, input_text: inputText || (prev?.input_text||'') }));
            setCurrentStep('input');
            toast.success('Parsed details added. Review and confirm.');
          }}
          parsedContext={draft}
        />
      )}
    </div>
  );
}

// AI chat widget component to collect essentials and feed into draft
type Message = { role: 'user' | 'assistant'; content: string };
function ChatCoach({ onClose, onApplyParsed, parsedContext }: { onClose: () => void; onApplyParsed: (parsed: any) => void; parsedContext?: any }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content:
        'Hi! I can plan your Goa trip. Tell me your travel dates (or duration), budget per person, party size, and interests (e.g., Beaches, Nightlife, Historical sites).',
    },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lastParsed, setLastParsed] = useState<any>(null);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const next: Message[] = [...messages, { role: 'user' as const, content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE_URL}/chat/coach`,
        { messages: next, context: { app: 'GoaGuide', parsed: parsedContext || null } },
        { headers: { 'x-user-id': 'demo-user-123' } }
      );
      const reply = res.data?.reply || 'Okay.';
      const parsed = res.data?.parsed || null;
      const done = !!res.data?.done;
      setMessages((curr) => [...curr, { role: 'assistant' as const, content: reply }]);
      setLastParsed(parsed);
      if (done && parsed) onApplyParsed(parsed);
    } catch (e) {
      setMessages((curr) => [
        ...curr,
        {
          role: 'assistant' as const,
          content:
            'Sorry, I had trouble. Could you share your dates (or duration), budget per person, party size, and interests?',
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/20 p-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b flex items-center justify-between bg-gradient-to-r from-orange-50 to-amber-50">
          <div className="font-semibold text-gray-900">GoaGuide AI Coach</div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
            ✕
          </button>
        </div>
        <div className="p-4 space-y-3 max-h-[60vh] overflow-auto">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`${
                m.role === 'assistant'
                  ? 'bg-orange-50 border border-orange-200 text-gray-900'
                  : 'bg-blue-50 border border-blue-200 text-gray-900'
              } rounded-xl px-3 py-2 text-sm`}
            >
              {m.content}
            </div>
          ))}
          {lastParsed && (
            <div className="text-xs text-gray-600">
              Parsed so far:{' '}
              {Object.entries(lastParsed)
                .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`)
                .join(' · ')}
            </div>
          )}
        </div>
        <div className="p-3 border-t flex items-center gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Type your message..."
            className="flex-1 border rounded-lg px-3 py-2"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="px-4 py-2 rounded-lg bg-gradient-to-r from-orange-500 to-pink-500 text-white disabled:opacity-50"
          >
            {loading ? '...' : 'Send'}
          </button>
          {lastParsed && (
            <button onClick={() => onApplyParsed(lastParsed)} className="px-3 py-2 rounded-lg border">
              Use details
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
function FeatureCard({ icon, title, description }: any) {
  return (
    <motion.div
      whileHover={{ scale: 1.05 }}
      className="bg-white p-6 rounded-xl shadow-sm border border-gray-100"
    >
      <div className="flex flex-col items-center text-center">
        <div className="mb-4">{icon}</div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-gray-600">{description}</p>
      </div>
    </motion.div>
  );
}

function QuestionsStep({ trip, onSubmit, loading }: any) {
  const [answers, setAnswers] = useState({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(answers);
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="max-w-2xl mx-auto"
    >
      <div className="mb-8">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Let's personalize your trip
        </h2>
        <p className="text-gray-600">
          A few quick questions to create your perfect Goa itinerary
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {trip.next_questions?.map((question: any) => (
          <div key={question.id} className="bg-white p-6 rounded-xl shadow-sm border">
            <label className="block text-lg font-medium text-gray-900 mb-3">
              {question.text}
              {question.required && <span className="text-red-500 ml-1">*</span>}
            </label>
            
            {question.type === 'text' && (
              <input
                type="text"
                value={answers[question.id] || ''}
                onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                className="w-full p-3 border border-gray-300 rounded-lg focus:border-orange-500 focus:ring-0"
                required={question.required}
              />
            )}

            {question.type === 'date' && (
              <input
                type="date"
                value={answers[question.id] || ''}
                onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                className="w-full p-3 border border-gray-300 rounded-lg focus:border-orange-500 focus:ring-0"
                required={question.required}
              />
            )}
            
            {question.type === 'single_choice' && (
              <div className="space-y-2">
                {question.options?.map((option: string) => (
                  <label key={option} className="flex items-center">
                    <input
                      type="radio"
                      name={question.id}
                      value={option}
                      checked={answers[question.id] === option}
                      onChange={(e) => setAnswers({ ...answers, [question.id]: e.target.value })}
                      className="mr-3 text-orange-500 focus:ring-orange-500"
                      required={question.required}
                    />
                    <span className="text-gray-700">{option}</span>
                  </label>
                ))}
              </div>
            )}
            
            {question.type === 'multiple_choice' && (
              <div className="space-y-2">
                {question.options?.map((option: string) => (
                  <label key={option} className="flex items-center">
                    <input
                      type="checkbox"
                      value={option}
                      checked={(answers[question.id] || []).includes(option)}
                      onChange={(e) => {
                        const current = answers[question.id] || [];
                        const updated = e.target.checked
                          ? [...current, option]
                          : current.filter((item: string) => item !== option);
                        setAnswers({ ...answers, [question.id]: updated });
                      }}
                      className="mr-3 text-orange-500 focus:ring-orange-500"
                    />
                    <span className="text-gray-700">{option}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-orange-500 text-white py-4 px-6 rounded-xl font-semibold hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Creating your itinerary...' : 'Continue'}
        </button>
      </form>
    </motion.div>
  );
}

function ItineraryStep({ itinerary }: any) {
  const [localItinerary, setLocalItinerary] = useState(itinerary);
  const router = useRouter();
  const [budgetDelta, setBudgetDelta] = useState(0);
  const interestOptions = [
    'Beaches',
    'Historical sites',
    'Adventure sports',
    'Nightlife',
    'Local cuisine',
    'Shopping',
    'Nature/Wildlife',
  ];
  const [selectedInterests, setSelectedInterests] = useState<string[]>(Array.isArray(localItinerary?.preferences?.interests) ? localItinerary.preferences.interests : []);

  // Helpers to build stay deeplinks (Google Hotels, Booking.com, MakeMyTrip)
  const buildStayLink = (near: string, checkinDateISO: string) => {
    try {
      const checkin = new Date(checkinDateISO);
      const checkout = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate() + 1);
      const iso = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0];
      const adults = (localItinerary.preferences?.party_size || localItinerary.party_size || 2) as number;
      const nightly = (localItinerary.preferences?.budget_per_person || localItinerary.budget_per_person || 0) as number;
      // Simple heuristic for label
      let kind: 'hostels' | 'family' | 'hotels' = 'hotels';
      if (adults >= 4) kind = 'family';
      if (nightly && nightly <= 1500 && adults <= 2) kind = 'hostels';
      const label = kind === 'hostels' ? 'Find hostels nearby' : kind === 'family' ? 'Find family-friendly stays' : 'Find hotels nearby';
      const qBase = kind === 'hostels' ? 'hostels' : (kind === 'family' ? 'family friendly hotels' : 'hotels');
      const params = new URLSearchParams();
      params.set('checkin', iso(checkin));
      params.set('checkout', iso(checkout));
      params.set('adults', String(adults));
      params.set('hl', 'en-IN');
      params.set('gl', 'IN');
      const q = `${qBase} near ${near || 'Goa'}, Goa ${nightly ? `under ₹${nightly} per night` : ''}`.trim();
      params.set('q', q);
      const href = `https://www.google.com/travel/hotels/${encodeURIComponent((near || 'Goa') + ', Goa')}?${params.toString()}`;
      return { href, label };
    } catch {
      return { href: `https://www.google.com/travel/hotels/Goa`, label: 'Find stays' };
    }
  };

  const buildExternalStayLinks = (near: string, checkinISO: string) => {
    const checkin = new Date(checkinISO);
    const checkout = new Date(checkin.getFullYear(), checkin.getMonth(), checkin.getDate() + 1);
    const iso = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0];
    const adults = (localItinerary.preferences?.party_size || localItinerary.party_size || 2) as number;
    const nightly = (localItinerary.preferences?.budget_per_person || localItinerary.budget_per_person || 0) as number;
    const place = `${near || 'Goa'}, Goa`;

    // Booking.com price level mapping 1..5
    let pri = 3;
    if (nightly) {
      if (nightly <= 1500) pri = 1; else if (nightly <= 3000) pri = 2; else if (nightly <= 6000) pri = 3; else if (nightly <= 9000) pri = 4; else pri = 5;
    }
    const bookingParams = new URLSearchParams({
      ss: place,
      checkin: iso(checkin),
      checkout: iso(checkout),
      group_adults: String(adults),
      no_rooms: '1',
      group_children: '0',
      selected_currency: 'INR',
    });
    bookingParams.set('nflt', `pri%3D${pri}`);
    const bookingUrl = `https://www.booking.com/searchresults.html?${bookingParams.toString()}`;

    // MakeMyTrip
    const maxPrice = nightly && nightly > 500 ? nightly : 0;
    const mmtParams = new URLSearchParams({
      checkin: iso(checkin),
      checkout: iso(checkout),
      city: 'Goa',
      locusId: 'CTGOI',
      locusType: 'city',
    });
    mmtParams.set('roomStayQualifier', `${adults}e0e`);
    if (maxPrice) mmtParams.set('filters', `PRICE_RANGE:between-0-${maxPrice}`);
    const mmtUrl = `https://www.makemytrip.com/hotels/hotel-listing/?${mmtParams.toString()}`;

    return [
      { provider: 'Booking.com', href: bookingUrl },
      { provider: 'MakeMyTrip', href: mmtUrl },
    ];
  };

  const handleReoptimize = async () => {
    try {
      toast.loading('Re-optimizing itinerary...', { id: 'reopt' });
      // Ask backend to re-optimize with a small budget tweak as demo
      await axios.post(`${API_BASE_URL}/trips/${localItinerary.trip_id}/optimize`, {
        budget_adjustment: budgetDelta,
        interests: selectedInterests,
      }, {
        headers: { 'x-user-id': 'demo-user-123' }
      });

      // Re-fetch itinerary
      const refreshed = await axios.get(`${API_BASE_URL}/trips/${localItinerary.trip_id}/itinerary`, {
        headers: { 'x-user-id': 'demo-user-123' }
      });
      setLocalItinerary(refreshed.data);
      toast.success('Itinerary updated!', { id: 'reopt' });
    } catch (e) {
      console.error(e);
      toast.error('Failed to re-optimize itinerary', { id: 'reopt' });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      {(() => {
        // Whole-trip hotels deeplink: uses first and last day, party size, budget
        try {
          const days = Array.isArray(localItinerary.itinerary) ? localItinerary.itinerary : [];
          if (days.length) {
            const start = new Date(days[0].date);
            const last = new Date(days[days.length - 1].date);
            const checkout = new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1);
            const iso = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0];
            const adults = localItinerary.preferences?.party_size || localItinerary.party_size || 2;
            const nightlyBudget = localItinerary.preferences?.budget_per_person || localItinerary.budget_per_person || '';
            const q = `hotels in Goa ${nightlyBudget ? `under ₹${nightlyBudget} per night` : ''}`.trim();
            const params = new URLSearchParams({
              checkin: iso(start),
              checkout: iso(checkout),
              adults: String(adults),
              hl: 'en-IN',
              gl: 'IN',
              q,
            });
            const tripHotelsUrl = `https://www.google.com/travel/hotels/Goa?${params.toString()}`;
            return (
              <div className="flex justify-end">
                <a href={tripHotelsUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white border text-pink-700 border-pink-300 hover:bg-pink-50">
                  Find stays for whole trip
                </a>
              </div>
            );
          }
        } catch {}
        return null;
      })()}
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Your Goa Adventure Awaits! 🏖️
        </h2>
        <div className="flex justify-center items-center space-x-8 text-lg flex-wrap gap-y-3">
          <div className="flex items-center">
            <span className="font-semibold">Total Cost:</span>
            <span className={`ml-2 px-3 py-1 rounded-full text-white ${
              itinerary.budget_status === 'within_budget' ? 'bg-green-500' : 'bg-red-500'
            }`}>
              ₹{localItinerary.total_cost?.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center">
            <span className="font-semibold">Optimization Score:</span>
            <span className="ml-2 text-orange-600 font-bold">{localItinerary.optimization_score}/100</span>
          </div>
          {localItinerary.weather && (
            <div className="flex items-center">
              <span className="font-semibold">Weather:</span>
              <div className="ml-2">
                <div className="inline-block px-3 py-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
                  {Math.round(localItinerary.weather.temperature)}°C · {localItinerary.weather.condition}
                </div>
                {localItinerary.weather.description && (
                  <div className="text-sm text-blue-700/80 mt-1">
                    {localItinerary.weather.description}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Narrative summary removed per request */}

      {localItinerary.stay_suggestions && localItinerary.stay_suggestions.length > 0 && (
        <div className="bg-white rounded-xl shadow-sm border p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Where to Stay</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {localItinerary.stay_suggestions.map((s: any, idx: number) => {
              const mapsUrl = `https://www.google.com/maps/search/${encodeURIComponent(s.area + ', Goa')}`;
              // Build Google Hotels URL with criteria from itinerary preferences and dates
              const days = Array.isArray(localItinerary.itinerary) ? localItinerary.itinerary : [];
              const checkin = days.length ? new Date(days[0].date) : null;
              const last = days.length ? new Date(days[days.length - 1].date) : null;
              const checkout = last ? new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1) : null;
              const iso = (d: Date | null) => d ? new Date(d.getFullYear(), d.getMonth(), d.getDate()).toISOString().split('T')[0] : '';
              const adults = localItinerary.preferences?.party_size || localItinerary.party_size || 2;
              const nightlyBudget = localItinerary.preferences?.budget_per_person || localItinerary.budget_per_person || '';
              const params = new URLSearchParams();
              if (checkin) params.set('checkin', iso(checkin));
              if (checkout) params.set('checkout', iso(checkout));
              if (adults) params.set('adults', String(adults));
              params.set('hl','en-IN');
              params.set('gl','IN');
              const q = `hotels near ${s.area}, Goa ${nightlyBudget ? `under ₹${nightlyBudget} per night` : ''}`.trim();
              params.set('q', q);
              const hotelsUrl = `https://www.google.com/travel/hotels/${encodeURIComponent(s.area + ', Goa')}?${params.toString()}`;
              return (
                <div key={idx} className="border rounded-lg p-4 bg-orange-50 border-orange-200">
                  <div className="font-semibold text-orange-800">{s.area}</div>
                  <div className="text-sm text-orange-900/80">{s.why}</div>
                  <div className="text-xs text-orange-700 mt-1">Best for: {s.good_for}</div>
                  <div className="mt-3 flex gap-2">
                    <a href={mapsUrl} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-orange-700 border border-orange-300 hover:bg-orange-100">Open in Maps</a>
                    <a href={hotelsUrl} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-pink-700 border border-pink-300 hover:bg-pink-100">Find Hotels</a>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {localItinerary.budget_status === 'over_budget' && localItinerary.alternatives?.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">
            💡 Budget Alternatives Available
          </h3>
          <p className="text-yellow-700 mb-4">
            Your itinerary exceeds budget by ₹{(localItinerary.total_cost - localItinerary.budget_limit).toLocaleString()}. 
            Here are some alternatives:
          </p>
          <div className="space-y-2">
            {localItinerary.alternatives.map((alt: any, index: number) => (
              <div key={index} className="bg-white p-3 rounded-lg">
                <span className="font-medium">{alt.description}</span>
                <span className="text-green-600 ml-2">Save ₹{alt.savings?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-6">
        {localItinerary.itinerary?.map((day: any, index: number) => (
          <div key={index} className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-xl font-semibold text-gray-900">Day {day.day} • {new Date(day.date).toLocaleDateString()}</h4>
                <div className="text-sm text-gray-500">{day.weather_recommendation}</div>
              </div>
              <div className="text-right">
                <div className="text-lg font-semibold text-orange-600">₹{day.estimated_cost?.toLocaleString()}</div>
                <div className="text-xs text-gray-500">includes transport ₹{(day.transport_cost || 0).toLocaleString?.() ?? '0'}</div>
              </div>
            </div>

            {day.ai_tip && (
              <div className="mt-3 text-sm text-teal-700 bg-teal-50 border border-teal-200 rounded-lg p-3">
                💡 {day.ai_tip}
              </div>
            )}

            <div className="space-y-4 mt-3">
              {day.activities?.map((activity: any, idx: number) => (
                <div key={idx} className="flex items-start justify-between py-3 border-b last:border-0">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 text-sm text-gray-500">
                      <span>{activity.time}</span>
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs ${
                        activity.time < '12:00' ? 'bg-green-50 text-green-700 border border-green-200' :
                        activity.time < '18:00' ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
                        'bg-purple-50 text-purple-700 border border-purple-200'
                      }`}>
                        {activity.time < '12:00' ? 'Morning' : activity.time < '18:00' ? 'Afternoon' : 'Evening'}
                      </span>
                    </div>
                    <div className="font-semibold text-gray-900">
                      {activity.activity?.name || activity.activity?.title}
                    </div>
                    <p className="text-sm text-gray-600">
                      {activity.activity?.description}
                    </p>
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-xs text-gray-500">Duration: {activity.duration}</span>
                      <span className="text-xs text-gray-500">Cost: ₹{(activity.activity?.estimated_cost || 0).toLocaleString?.() ?? '0'}</span>
                      {activity.travel_time_min && (
                        <span className="text-xs text-gray-500">Travel: {activity.travel_time_min} min</span>
                      )}
                    </div>
                    {activity.notes && (
                      <p className="text-xs text-blue-600 mt-1">💡 {activity.notes}</p>
                    )}
                  </div>
                  <div className="text-right">
                    {(() => {
                      const near = activity.activity?.area || activity.activity?.neighborhood || activity.activity?.name || 'Goa';
                      const { href, label } = buildStayLink(near, day.date);
                      return (
                        <a href={href} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-pink-700 border border-pink-300 hover:bg-pink-100">
                          {label}
                        </a>
                      );
                    })()}
                  </div>
                </div>
              ))}
            </div>

            {/* Transport tip for the day */}
            {day.transport?.local && (
              <div className="mt-3 text-sm text-gray-700 bg-amber-50 border border-amber-200 p-3 rounded-lg">
                🚗 {day.transport.local}
              </div>
            )}

            {/* Daily costs */}
            {day.costs && (
              <div className="mt-4 p-3 bg-white border rounded-lg">
                <div className="text-sm font-semibold text-gray-900 mb-1">Daily costs</div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="px-2 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">Per person: ₹{day.costs.per_person?.toLocaleString?.('en-IN') ?? day.costs.per_person}</span>
                  <span className="px-2 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">Group: ₹{day.costs.group_total?.toLocaleString?.('en-IN') ?? day.costs.group_total}</span>
                </div>
                {Array.isArray(day.costs.items) && day.costs.items.length > 0 && (
                  <div className="mt-2 text-xs text-gray-600 flex flex-wrap gap-2">
                    {day.costs.items.map((it:any, i:number)=> (
                      <span key={i} className="px-2 py-1 rounded bg-gray-50 border">{it.label}: ₹{it.per_person}/pp · ₹{it.group?.toLocaleString?.('en-IN') ?? it.group}</span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Stay nearby (single contextual button) */}
            <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="text-sm font-semibold text-orange-800 mb-2">Stay nearby</div>
              <div className="flex flex-wrap gap-2">
                {(() => {
                  const firstAct = (day.activities && day.activities[0]?.activity) || {};
                  const near = firstAct.area || firstAct.neighborhood || firstAct.name || 'Goa';
                  const { href, label } = buildStayLink(near, day.date);
                  return (
                    <a href={href} target="_blank" rel="noreferrer" className="text-xs px-3 py-1 rounded-lg bg-white text-pink-700 border border-pink-300 hover:bg-pink-100">
                      {label}
                    </a>
                  );
                })()}
              </div>
              <div className="mt-2 text-xs text-gray-600">
                {(() => {
                  const firstAct = (day.activities && day.activities[0]?.activity) || {};
                  const near = firstAct.area || firstAct.neighborhood || firstAct.name || 'Goa';
                  const links = buildExternalStayLinks(near, day.date);
                  return (
                    <span>
                      More options:
                      {' '}
                      <a href={links[0].href} target="_blank" rel="noreferrer" className="underline hover:text-gray-800">Booking.com</a>
                      {' • '}
                      <a href={links[1].href} target="_blank" rel="noreferrer" className="underline hover:text-gray-800">MakeMyTrip</a>
                    </span>
                  );
                })()}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Totals */}
      {localItinerary.totals && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 text-center">
          <div className="text-sm font-semibold text-gray-900 mb-1">Trip totals</div>
          <div className="flex justify-center gap-3 text-sm">
            <span className="px-3 py-1 rounded-full bg-green-50 text-green-700 border border-green-200">Per person: ₹{localItinerary.totals.per_person?.toLocaleString?.('en-IN') ?? localItinerary.totals.per_person}</span>
            <span className="px-3 py-1 rounded-full bg-purple-50 text-purple-700 border border-purple-200">Group: ₹{localItinerary.totals.group?.toLocaleString?.('en-IN') ?? localItinerary.totals.group}</span>
          </div>
        </div>
      )}

      <div className="bg-gradient-to-r from-orange-500 to-pink-500 text-white p-6 rounded-xl text-center space-y-3">
        <h3 className="text-xl font-bold mb-2">Ready to Book Your Adventure?</h3>
        <p className="mb-4">Your personalized Goa itinerary is ready! Start booking to secure the best deals.</p>
        <button
          onClick={() => {
            try {
              if (typeof window !== 'undefined') {
                window.localStorage.setItem('goaguide:lastItinerary', JSON.stringify(localItinerary));
              }
            } catch {}
            router.push({ pathname: '/booking', query: { tripId: localItinerary.trip_id } });
          }}
          className="bg-white text-orange-500 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
        >
          Start Booking Process
        </button>
        <div>
          <button
            onClick={handleReoptimize}
            className="mt-2 bg-white/90 text-pink-600 px-6 py-3 rounded-lg font-semibold hover:bg-white transition-colors border border-white"
          >
            Re-optimize Itinerary
          </button>
        </div>
      </div>
    </motion.div>
  );
}
