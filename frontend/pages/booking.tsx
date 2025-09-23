import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'

export default function Booking() {
  const router = useRouter()
  const { tripId } = router.query
  const [itinerary, setItinerary] = useState<any>(null)

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const raw = window.localStorage.getItem('goaguide:lastItinerary')
        if (raw) setItinerary(JSON.parse(raw))
      }
    } catch {}
  }, [])

  const summary = useMemo(() => {
    if (!itinerary) return null
    const days = itinerary.itinerary?.length || 0
    const total = itinerary.total_cost || 0
    return {
      days,
      total,
    }
  }, [itinerary])

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-orange-50">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">Booking Summary</h1>

        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <div className="text-gray-500 text-sm">Trip ID</div>
              <div className="font-semibold">{tripId}</div>
            </div>
            <div>
              <div className="text-gray-500 text-sm">Total Days</div>
              <div className="font-semibold">{summary?.days ?? '-'}</div>
            </div>
            <div>
              <div className="text-gray-500 text-sm">Total Estimated Cost</div>
              <div className="font-semibold">₹{summary?.total?.toLocaleString?.() ?? '-'}</div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border mb-6">
          <h2 className="text-xl font-semibold mb-4">What happens next?</h2>
          <ul className="list-disc list-inside text-gray-700 space-y-2">
            <li>Review your itinerary and decide your must-do activities.</li>
            <li>Contact our team to curate hotels, transport and tickets for each activity.</li>
            <li>Receive a final quote with vendor links and secure payment options.</li>
          </ul>
        </div>

        <div className="bg-gradient-to-r from-orange-500 to-pink-500 text-white p-6 rounded-xl text-center space-y-3">
          <h3 className="text-xl font-bold mb-2">Talk to a Travel Specialist</h3>
          <p className="opacity-90">We&apos;ll help you finalize bookings, get the best rates and make last-minute tweaks.</p>
          <a
            href={`mailto:bookings@goaguide.example?subject=GoaGuide%20Booking%20Request%20-%20Trip%20${tripId}&body=Hi%20GoaGuide%20Team,%0D%0A%0D%0APlease%20help%20me%20book%20my%20trip.%20Trip%20ID:%20${tripId}.%0D%0ATotal%20days:%20${summary?.days}.%0D%0ATotal%20estimated%20cost:%20₹${summary?.total}.%0D%0A%0D%0AThanks!`}
            className="inline-block bg-white text-orange-600 px-6 py-3 rounded-lg font-semibold hover:bg-gray-100 transition-colors"
          >
            Email Us to Book
          </a>
        </div>
      </div>
    </div>
  )
}
