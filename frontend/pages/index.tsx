import { useState } from 'react';
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

  const handleCreateTrip = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;

    setLoading(true);
    try {
      const response = await axios.post(`${API_BASE_URL}/trips`, {
        destination: 'Goa',
        input_text: inputText,
        party_size: 2,
        trip_type: 'family'
      }, {
        headers: {
          'x-user-id': 'demo-user-123',
          'Content-Type': 'application/json'
        }
      });

      setTrip(response.data);
      setCurrentStep('questions');
      toast.success('Trip created! Let\'s plan your perfect Goa adventure!');
    } catch (error) {
      console.error('Error creating trip:', error);
      toast.error('Failed to create trip. Please try again.');
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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50">
      <Toaster position="top-right" />
      
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
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
              <h2 className="text-4xl font-bold text-gray-900 mb-4">
                Plan Your Perfect Goa Trip
              </h2>
              <p className="text-xl text-gray-600 max-w-2xl mx-auto">
                Just tell us what you want to do in Goa, and we'll create a personalized, 
                budget-optimized itinerary for you!
              </p>
            </div>

            <form onSubmit={handleCreateTrip} className="max-w-2xl mx-auto">
              <div className="relative">
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="e.g., I want to go to Goa for 3 days with my family. We love beaches, local food, and some adventure activities. Our budget is around ₹8000 per person."
                  className="w-full p-6 text-lg border-2 border-gray-200 rounded-2xl focus:border-orange-500 focus:ring-0 resize-none h-32"
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !inputText.trim()}
                  className="absolute bottom-4 right-4 bg-orange-500 text-white p-3 rounded-xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {loading ? (
                    <div className="animate-spin h-6 w-6 border-2 border-white border-t-transparent rounded-full" />
                  ) : (
                    <PaperAirplaneIcon className="h-6 w-6" />
                  )}
                </button>
              </div>
            </form>

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
  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-8"
    >
      <div className="text-center">
        <h2 className="text-3xl font-bold text-gray-900 mb-4">
          Your Goa Adventure Awaits! 🏖️
        </h2>
        <div className="flex justify-center items-center space-x-8 text-lg">
          <div className="flex items-center">
            <span className="font-semibold">Total Cost:</span>
            <span className={`ml-2 px-3 py-1 rounded-full text-white ${
              itinerary.budget_status === 'within_budget' ? 'bg-green-500' : 'bg-red-500'
            }`}>
              ₹{itinerary.total_cost?.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center">
            <span className="font-semibold">Optimization Score:</span>
            <span className="ml-2 text-orange-600 font-bold">{itinerary.optimization_score}/100</span>
          </div>
        </div>
      </div>

      {itinerary.budget_status === 'over_budget' && itinerary.alternatives?.length > 0 && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-yellow-800 mb-2">
            💡 Budget Alternatives Available
          </h3>
          <p className="text-yellow-700 mb-4">
            Your itinerary exceeds budget by ₹{(itinerary.total_cost - itinerary.budget_limit).toLocaleString()}. 
            Here are some alternatives:
          </p>
          <div className="space-y-2">
            {itinerary.alternatives.map((alt: any, index: number) => (
              <div key={index} className="bg-white p-3 rounded-lg">
                <span className="font-medium">{alt.description}</span>
                <span className="text-green-600 ml-2">Save ₹{alt.savings?.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid gap-6">
        {itinerary.itinerary?.map((day: any, index: number) => (
          <div key={index} className="bg-white rounded-xl shadow-sm border p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold text-gray-900">
                Day {day.day} - {new Date(day.date).toLocaleDateString()}
              </h3>
              <div className="text-right">
                <div className="text-lg font-semibold text-orange-600">
                  ₹{day.estimated_cost?.toLocaleString()}
                </div>
                <div className="text-sm text-gray-500">per day</div>
              </div>
            </div>

            {day.weather_recommendation && (
              <div className="bg-blue-50 p-3 rounded-lg mb-4">
                <p className="text-blue-800">🌤️ {day.weather_recommendation}</p>
              </div>
            )}

            <div className="space-y-4">
              {day.activities?.map((activity: any, actIndex: number) => (
                <div key={actIndex} className="flex items-start space-x-4 p-4 bg-gray-50 rounded-lg">
                  <div className="text-sm font-medium text-gray-500 min-w-[60px]">
                    {activity.time}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-semibold text-gray-900">
                      {activity.activity.name || activity.activity.title}
                    </h4>
                    <p className="text-gray-600 text-sm mb-2">
                      {activity.activity.description}
                    </p>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Duration: {activity.duration}</span>
                      <span className="font-medium text-orange-600">
                        ₹{activity.activity.estimated_cost || 0}
                      </span>
                    </div>
                    {activity.notes && (
                      <p className="text-xs text-blue-600 mt-1">💡 {activity.notes}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="bg-gradient-to-r from-orange-500 to-pink-500 text-white p-6 rounded-xl text-center">
        <h3 className="text-xl font-bold mb-2">Ready to Book Your Adventure?</h3>
        <p className="mb-4">Your personalized Goa itinerary is ready! Start booking to secure the best deals.</p>
        <button className="bg-white text-orange-500 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors">
          Start Booking Process
        </button>
      </div>
    </motion.div>
  );
}
