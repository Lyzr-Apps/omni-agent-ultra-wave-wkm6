'use client'

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { callAIAgent, extractText } from '@/lib/aiAgent'
import { useRAGKnowledgeBase } from '@/lib/ragKnowledgeBase'
import { useLyzrAgentEvents } from '@/lib/lyzrAgentEvents'
import { AgentActivityPanel } from '@/components/AgentActivityPanel'
import { RiDashboardLine, RiChat3Line, RiChat3Fill, RiPhoneLine, RiPhoneFill, RiHistoryLine, RiSendPlaneFill, RiMicLine, RiMicOffLine, RiPhoneOffLine, RiDatabase2Line, RiUploadCloud2Line, RiDeleteBinLine, RiCloseLine, RiArrowDownSLine, RiSearchLine, RiTimeLine, RiTicketLine, RiGlobalLine, RiFileTextLine, RiCheckboxCircleLine, RiAlertLine, RiCustomerService2Fill, RiLoader4Line, RiVoiceprintLine } from 'react-icons/ri'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'

// ---- Constants ----
const CHAT_AGENT_ID = '6993bbeb798fe23bc479a7e4'
const VOICE_AGENT_ID = '6993bbfd28f956cd38c67036'
const RAG_ID = '6993bbca869797813b09b4ec'

// ---- Types ----
interface ChatMessage {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: string
  ticketCreated?: boolean
  ticketId?: string
  ticketSubject?: string
  sourcesUsed?: string[]
  needsEscalation?: boolean
}

interface VoiceTranscript {
  id: string
  role: 'user' | 'agent'
  text: string
  timestamp: string
}

interface ConversationRecord {
  id: string
  channel: 'chat' | 'voice'
  customerName: string
  subject: string
  status: 'resolved' | 'pending' | 'escalated'
  messageCount: number
  duration: string
  date: string
  ticketId?: string
  messages: { role: 'user' | 'agent'; text: string }[]
}

type ActiveView = 'dashboard' | 'chat' | 'voice' | 'history' | 'kb'
type CallState = 'idle' | 'connecting' | 'listening' | 'processing' | 'speaking'

// ---- UUID generator ----
function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'id-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)
}

// ---- Time helpers ----
function timeAgo(dateStr: string): string {
  try {
    const now = Date.now()
    const then = new Date(dateStr).getTime()
    const diff = now - then
    const mins = Math.floor(diff / 60000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m ago`
    const hrs = Math.floor(mins / 60)
    if (hrs < 24) return `${hrs}h ago`
    const days = Math.floor(hrs / 24)
    return `${days}d ago`
  } catch {
    return ''
  }
}

function currentTimestamp(): string {
  return new Date().toISOString()
}

// ---- Markdown renderer ----
function formatInline(text: string) {
  const parts = text.split(/\*\*(.*?)\*\*/g)
  if (parts.length === 1) return text
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <strong key={i} className="font-semibold">{part}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    )
  )
}

function renderMarkdown(text: string) {
  if (!text) return null
  return (
    <div className="space-y-1.5">
      {text.split('\n').map((line, i) => {
        if (line.startsWith('### ')) return <h4 key={i} className="font-semibold text-sm mt-2 mb-1">{line.slice(4)}</h4>
        if (line.startsWith('## ')) return <h3 key={i} className="font-semibold text-base mt-2 mb-1">{line.slice(3)}</h3>
        if (line.startsWith('# ')) return <h2 key={i} className="font-bold text-lg mt-3 mb-1">{line.slice(2)}</h2>
        if (line.startsWith('- ') || line.startsWith('* ')) return <li key={i} className="ml-4 list-disc text-sm">{formatInline(line.slice(2))}</li>
        if (/^\d+\.\s/.test(line)) return <li key={i} className="ml-4 list-decimal text-sm">{formatInline(line.replace(/^\d+\.\s/, ''))}</li>
        if (!line.trim()) return <div key={i} className="h-1" />
        return <p key={i} className="text-sm">{formatInline(line)}</p>
      })}
    </div>
  )
}

// ---- Mock conversation data ----
function getMockConversations(): ConversationRecord[] {
  return [
    { id: 'conv-1', channel: 'chat', customerName: 'Sarah Chen', subject: 'Billing inquiry about recent charge', status: 'resolved', messageCount: 6, duration: '4m', date: '2026-02-17T09:15:00Z', ticketId: 'TKT-1042', messages: [{ role: 'user', text: 'I see an unexpected charge on my account.' }, { role: 'agent', text: 'I can help you investigate that. Could you share the charge amount and date?' }] },
    { id: 'conv-2', channel: 'voice', customerName: 'Marcus Williams', subject: 'Product return request', status: 'pending', messageCount: 0, duration: '8m 32s', date: '2026-02-17T08:42:00Z', messages: [{ role: 'user', text: 'I need to return a defective item.' }, { role: 'agent', text: 'I am sorry to hear that. Let me initiate a return for you right away.' }] },
    { id: 'conv-3', channel: 'chat', customerName: 'Priya Sharma', subject: 'Account access issue', status: 'resolved', messageCount: 4, duration: '3m', date: '2026-02-17T07:30:00Z', messages: [{ role: 'user', text: 'I cannot log into my account.' }, { role: 'agent', text: 'I can assist with account recovery. Please verify your email address.' }] },
    { id: 'conv-4', channel: 'chat', customerName: 'James O\'Brien', subject: 'Shipping delay question', status: 'escalated', messageCount: 8, duration: '6m', date: '2026-02-16T16:20:00Z', ticketId: 'TKT-1039', messages: [{ role: 'user', text: 'My order has been in transit for 2 weeks.' }, { role: 'agent', text: 'Let me check the tracking details for your order.' }] },
    { id: 'conv-5', channel: 'voice', customerName: 'Aisha Patel', subject: 'Subscription cancellation', status: 'resolved', messageCount: 0, duration: '5m 15s', date: '2026-02-16T14:50:00Z', messages: [{ role: 'user', text: 'I would like to cancel my subscription.' }, { role: 'agent', text: 'I can process that for you. May I ask the reason for cancellation?' }] },
    { id: 'conv-6', channel: 'chat', customerName: 'David Kim', subject: 'Feature request discussion', status: 'pending', messageCount: 3, duration: '2m', date: '2026-02-16T11:10:00Z', messages: [{ role: 'user', text: 'Is there a way to export data as CSV?' }, { role: 'agent', text: 'That feature is on our roadmap. I have created a ticket for your request.' }] },
    { id: 'conv-7', channel: 'voice', customerName: 'Emily Turner', subject: 'Technical support for setup', status: 'resolved', messageCount: 0, duration: '12m 08s', date: '2026-02-15T15:30:00Z', messages: [{ role: 'user', text: 'I need help setting up the integration.' }, { role: 'agent', text: 'I will walk you through the setup process step by step.' }] },
    { id: 'conv-8', channel: 'chat', customerName: 'Roberto Sanchez', subject: 'Discount code not working', status: 'resolved', messageCount: 5, duration: '3m', date: '2026-02-15T10:05:00Z', ticketId: 'TKT-1035', messages: [{ role: 'user', text: 'The promo code SAVE20 is not applying at checkout.' }, { role: 'agent', text: 'Let me verify that code in our system and apply the discount manually.' }] },
  ]
}

// ---- Glass card class ----
const glassCard = 'backdrop-blur-[16px] bg-white/75 border border-white/[0.18] rounded-[0.875rem] shadow-md'

// ---- Sidebar Nav Item ----
function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3 rounded-[0.875rem] text-sm font-medium transition-all duration-200 ${active ? 'bg-primary text-white shadow-md' : 'text-foreground/70 hover:bg-secondary hover:text-foreground'}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  )
}

// ---- Status Badge ----
function StatusBadge({ status }: { status: 'resolved' | 'pending' | 'escalated' }) {
  const config: Record<string, { bg: string; label: string }> = {
    resolved: { bg: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Resolved' },
    pending: { bg: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Pending' },
    escalated: { bg: 'bg-red-100 text-red-700 border-red-200', label: 'Escalated' },
  }
  const c = config[status] || config.pending
  return <Badge variant="outline" className={`${c.bg} border text-xs font-medium`}>{c.label}</Badge>
}

// ---- Voice Pulse Visualizer ----
function VoicePulse({ state }: { state: CallState }) {
  const isActive = state === 'listening' || state === 'speaking' || state === 'processing'
  const ringColor = state === 'speaking' ? 'border-amber-400' : state === 'processing' ? 'border-purple-400' : 'border-emerald-400'
  return (
    <div className="relative flex items-center justify-center w-48 h-48">
      {isActive && <div className={`absolute w-48 h-48 rounded-full ${ringColor} border-2 animate-ping opacity-20`} />}
      {isActive && <div className={`absolute w-36 h-36 rounded-full ${ringColor} border-2 animate-pulse opacity-30`} />}
      {isActive && <div className={`absolute w-24 h-24 rounded-full ${ringColor} border-2 animate-pulse opacity-40`} />}
      <div className={`relative w-20 h-20 rounded-full flex items-center justify-center shadow-lg ${state === 'idle' ? 'bg-muted' : state === 'speaking' ? 'bg-amber-100' : state === 'processing' ? 'bg-purple-100' : 'bg-emerald-100'}`}>
        {state === 'idle' && <RiPhoneFill className="w-8 h-8 text-muted-foreground" />}
        {state === 'connecting' && <RiLoader4Line className="w-8 h-8 text-emerald-600 animate-spin" />}
        {state === 'processing' && <RiLoader4Line className="w-8 h-8 text-purple-600 animate-spin" />}
        {state === 'speaking' && <RiVoiceprintLine className="w-8 h-8 text-amber-600" />}
        {state === 'listening' && <RiMicLine className="w-8 h-8 text-emerald-600" />}
      </div>
    </div>
  )
}

// ---- Dashboard View ----
function DashboardView({ onNavigate, sampleData, conversations }: { onNavigate: (v: ActiveView) => void; sampleData: boolean; conversations: ConversationRecord[] }) {
  const recentConvos = sampleData ? conversations.slice(0, 5) : []
  const todayCount = sampleData ? conversations.filter(c => c.date.startsWith('2026-02-17')).length : 0
  const openTickets = sampleData ? conversations.filter(c => c.status === 'pending' || c.status === 'escalated').length : 0
  const resolved = sampleData ? conversations.filter(c => c.status === 'resolved').length : 0
  const satisfaction = sampleData ? '4.7 / 5.0' : '--'

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Overview of your customer support activity</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <button onClick={() => onNavigate('chat')} className={`${glassCard} p-6 text-left transition-all duration-300 hover:shadow-xl hover:scale-[1.02] group`}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <RiChat3Fill className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Start Chat</h3>
              <p className="text-sm text-muted-foreground">Text-based customer support</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Get instant help through our AI-powered chat agent with knowledge base access.</p>
        </button>

        <button onClick={() => onNavigate('voice')} className={`${glassCard} p-6 text-left transition-all duration-300 hover:shadow-xl hover:scale-[1.02] group`}>
          <div className="flex items-center gap-4 mb-4">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shadow-lg shadow-amber-500/20">
              <RiPhoneFill className="w-7 h-7 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-foreground">Start Voice Call</h3>
              <p className="text-sm text-muted-foreground">Voice-based customer support</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Speak directly with our AI voice agent for hands-free assistance.</p>
        </button>
      </div>

      <div className={`${glassCard} p-6`}>
        <h3 className="text-xs font-semibold text-muted-foreground mb-4 uppercase tracking-wide">Summary</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div>
            <p className="text-2xl font-bold text-foreground">{sampleData ? todayCount : '--'}</p>
            <p className="text-xs text-muted-foreground mt-1">Today&apos;s Conversations</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{sampleData ? openTickets : '--'}</p>
            <p className="text-xs text-muted-foreground mt-1">Open Tickets</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{sampleData ? resolved : '--'}</p>
            <p className="text-xs text-muted-foreground mt-1">Resolved</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-foreground">{satisfaction}</p>
            <p className="text-xs text-muted-foreground mt-1">Avg. Satisfaction</p>
          </div>
        </div>
      </div>

      <div className={`${glassCard} p-6`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Recent Activity</h3>
          <Button variant="ghost" size="sm" className="text-xs text-primary" onClick={() => onNavigate('history')}>View All</Button>
        </div>
        {recentConvos.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <RiTimeLine className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">No recent activity. Enable sample data to see demo conversations.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {recentConvos.map(conv => (
              <div key={conv.id} className="flex items-center gap-4 p-3 rounded-xl hover:bg-secondary/50 transition-colors">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${conv.channel === 'chat' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                  {conv.channel === 'chat' ? <RiChat3Line className="w-4 h-4 text-emerald-600" /> : <RiPhoneLine className="w-4 h-4 text-amber-600" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{conv.customerName}</p>
                    <StatusBadge status={conv.status} />
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{conv.subject}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-muted-foreground">{timeAgo(conv.date)}</p>
                  <p className="text-xs text-muted-foreground">{conv.channel === 'chat' ? `${conv.messageCount} msgs` : conv.duration}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Chat View ----
function ChatView({ sampleData }: { sampleData: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState('')
  const [chatActive, setChatActive] = useState(false)
  const [expandedSources, setExpandedSources] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  useEffect(() => {
    if (sampleData && messages.length === 0 && !chatActive) {
      const now = currentTimestamp()
      setMessages([
        { id: 's1', role: 'agent', text: 'Hello! Welcome to OmniServe support. How can I help you today?', timestamp: now },
        { id: 's2', role: 'user', text: 'I have a question about my recent order. The tracking shows it was delivered but I never received it.', timestamp: now },
        { id: 's3', role: 'agent', text: 'I am sorry to hear that. Let me look into your order details. Could you please provide your order number so I can investigate?', timestamp: now, sourcesUsed: ['Order Management FAQ', 'Shipping Policy Guide'] },
        { id: 's4', role: 'user', text: 'Sure, it is ORD-78234.', timestamp: now },
        { id: 's5', role: 'agent', text: 'Thank you. I have found your order ORD-78234. According to the carrier, the package was marked as delivered on February 15th. I have created a support ticket to investigate this with the shipping provider.', timestamp: now, ticketCreated: true, ticketId: 'TKT-1048', ticketSubject: 'Missing package investigation - ORD-78234', sourcesUsed: ['Shipping Policy Guide', 'Lost Package Procedures'] },
      ])
      setChatActive(true)
      setSessionId(generateId())
    }
  }, [sampleData, messages.length, chatActive])

  const startChat = useCallback(() => {
    const sid = generateId()
    setSessionId(sid)
    setChatActive(true)
    setMessages([{
      id: generateId(),
      role: 'agent',
      text: 'Hello! Welcome to OmniServe support. How can I assist you today?',
      timestamp: currentTimestamp(),
    }])
    setStatusMsg('')
  }, [])

  const endChat = useCallback(() => {
    setChatActive(false)
    setMessages([])
    setSessionId('')
    setInput('')
    setStatusMsg('')
  }, [])

  const sendMessage = useCallback(async () => {
    const trimmed = input.trim()
    if (!trimmed || loading) return

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      text: trimmed,
      timestamp: currentTimestamp(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setStatusMsg('')

    try {
      const result = await callAIAgent(trimmed, CHAT_AGENT_ID, { session_id: sessionId })
      if (result.success) {
        const data = result?.response?.result || {}
        const agentMessage = data?.message || result?.response?.message || extractText(result.response) || 'I received your message. Let me look into this for you.'
        const ticketCreated = data?.ticket_created === true
        const ticketId = data?.ticket_id || ''
        const ticketSubject = data?.ticket_subject || ''
        const sourcesUsed = Array.isArray(data?.sources_used) ? data.sources_used : []
        const needsEscalation = data?.needs_escalation === true

        const agentMsg: ChatMessage = {
          id: generateId(),
          role: 'agent',
          text: agentMessage,
          timestamp: currentTimestamp(),
          ticketCreated,
          ticketId,
          ticketSubject,
          sourcesUsed,
          needsEscalation,
        }
        setMessages(prev => [...prev, agentMsg])
      } else {
        setStatusMsg('Failed to get a response. Please try again.')
        const errMsg: ChatMessage = {
          id: generateId(),
          role: 'agent',
          text: 'I apologize, but I encountered an issue processing your request. Please try again.',
          timestamp: currentTimestamp(),
        }
        setMessages(prev => [...prev, errMsg])
      }
    } catch {
      setStatusMsg('A network error occurred. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }, [input, loading, sessionId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }, [sendMessage])

  if (!chatActive) {
    return (
      <div className="flex flex-col items-center justify-center h-full">
        <div className={`${glassCard} p-10 text-center max-w-md`}>
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center mx-auto mb-6 shadow-lg shadow-emerald-500/20">
            <RiChat3Fill className="w-10 h-10 text-white" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-2">Chat Support</h2>
          <p className="text-sm text-muted-foreground mb-6">Start a conversation with our AI support agent. Get help with billing, orders, account issues, and more.</p>
          <Button onClick={startChat} className="bg-primary text-primary-foreground hover:bg-primary/90 px-8 py-3 rounded-xl text-sm font-semibold">Start Chat</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className={`${glassCard} px-6 py-4 flex items-center justify-between mb-4`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
            <RiChat3Fill className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-foreground">Chat Support Agent</h2>
            <p className="text-xs text-muted-foreground">Session: {sessionId.slice(0, 8)}...</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={endChat} className="text-xs gap-1 rounded-lg">
          <RiCloseLine className="w-4 h-4" /> End Chat
        </Button>
      </div>

      <div className={`${glassCard} flex-1 flex flex-col min-h-0 overflow-hidden`}>
        <ScrollArea className="flex-1 p-6">
          <div ref={scrollRef} className="space-y-4">
            {messages.map(msg => (
              <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] ${msg.role === 'user' ? 'bg-primary text-primary-foreground rounded-2xl rounded-br-md px-5 py-3' : 'bg-secondary rounded-2xl rounded-bl-md px-5 py-3'}`}>
                  <div className={`text-sm ${msg.role === 'user' ? '' : 'text-foreground'}`}>
                    {renderMarkdown(msg.text)}
                  </div>

                  {msg.ticketCreated && (
                    <div className={`mt-3 p-3 rounded-xl border ${msg.role === 'user' ? 'border-white/30 bg-white/10' : 'border-emerald-200 bg-emerald-50'}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <RiTicketLine className={`w-4 h-4 ${msg.role === 'user' ? 'text-white' : 'text-emerald-600'}`} />
                        <span className="text-xs font-semibold">Ticket Created</span>
                      </div>
                      {msg.ticketId && <p className="text-xs font-mono">{msg.ticketId}</p>}
                      {msg.ticketSubject && <p className="text-xs mt-0.5 opacity-80">{msg.ticketSubject}</p>}
                    </div>
                  )}

                  {msg.needsEscalation && (
                    <div className={`mt-3 p-3 rounded-xl flex items-center gap-2 ${msg.role === 'user' ? 'bg-white/10 border border-white/30' : 'bg-amber-50 border border-amber-200'}`}>
                      <RiAlertLine className={`w-4 h-4 shrink-0 ${msg.role === 'user' ? 'text-white' : 'text-amber-600'}`} />
                      <span className="text-xs font-medium">This issue requires escalation to a human agent.</span>
                    </div>
                  )}

                  {Array.isArray(msg.sourcesUsed) && msg.sourcesUsed.length > 0 && (
                    <div className="mt-2">
                      <button
                        onClick={() => setExpandedSources(expandedSources === msg.id ? null : msg.id)}
                        className="flex items-center gap-1 text-xs opacity-70 hover:opacity-100 transition-opacity"
                      >
                        <RiFileTextLine className="w-3 h-3" />
                        <span>{msg.sourcesUsed.length} source{msg.sourcesUsed.length > 1 ? 's' : ''}</span>
                        <RiArrowDownSLine className={`w-3 h-3 transition-transform ${expandedSources === msg.id ? 'rotate-180' : ''}`} />
                      </button>
                      {expandedSources === msg.id && (
                        <div className={`mt-1.5 p-2 rounded-lg text-xs space-y-1 ${msg.role === 'user' ? 'bg-white/10' : 'bg-muted/50'}`}>
                          {msg.sourcesUsed.map((s, si) => (
                            <p key={si} className="flex items-center gap-1.5">
                              <RiCheckboxCircleLine className="w-3 h-3 shrink-0 text-emerald-500" /> {s}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <p className={`text-[10px] mt-2 ${msg.role === 'user' ? 'text-white/60' : 'text-muted-foreground'}`}>
                    {timeAgo(msg.timestamp)}
                  </p>
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-secondary rounded-2xl rounded-bl-md px-5 py-3">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {statusMsg && (
          <div className="px-6 py-2">
            <p className="text-xs text-destructive flex items-center gap-1"><RiAlertLine className="w-3 h-3" /> {statusMsg}</p>
          </div>
        )}

        <div className="p-4 border-t border-border/50">
          <div className="flex gap-3">
            <Input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your message..."
              className="flex-1 rounded-xl border-input bg-background"
              disabled={loading}
            />
            <Button onClick={sendMessage} disabled={!input.trim() || loading} className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-xl px-4">
              {loading ? <RiLoader4Line className="w-5 h-5 animate-spin" /> : <RiSendPlaneFill className="w-5 h-5" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---- Voice View ----
function VoiceView() {
  const [callState, setCallState] = useState<CallState>('idle')
  const [isMuted, setIsMuted] = useState(false)
  const [transcripts, setTranscripts] = useState<VoiceTranscript[]>([])
  const [showTranscripts, setShowTranscripts] = useState(true)
  const [statusMsg, setStatusMsg] = useState('')

  const wsRef = useRef<WebSocket | null>(null)
  const sampleRateRef = useRef(24000)
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const isMutedRef = useRef(false)
  const nextPlayTimeRef = useRef(0)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    isMutedRef.current = isMuted
  }, [isMuted])

  useEffect(() => {
    if (transcriptScrollRef.current) {
      transcriptScrollRef.current.scrollTop = transcriptScrollRef.current.scrollHeight
    }
  }, [transcripts])

  const addTranscript = useCallback((msg: Record<string, unknown>) => {
    const text = (typeof msg?.text === 'string' ? msg.text : '') || (typeof msg?.transcript === 'string' ? msg.transcript : '')
    if (!text) return
    setTranscripts(prev => [...prev, {
      id: generateId(),
      role: msg?.role === 'user' ? 'user' : 'agent',
      text,
      timestamp: currentTimestamp(),
    }])
  }, [])

  const playAudioChunk = useCallback((base64Audio: string) => {
    if (!audioContextRef.current) return
    const ctx = audioContextRef.current
    try {
      const binaryStr = atob(base64Audio)
      const bytes = new Uint8Array(binaryStr.length)
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i)
      const pcm16 = new Int16Array(bytes.buffer)
      const float32 = new Float32Array(pcm16.length)
      for (let i = 0; i < pcm16.length; i++) float32[i] = pcm16[i] / 32768

      const buffer = ctx.createBuffer(1, float32.length, sampleRateRef.current)
      buffer.getChannelData(0).set(float32)
      const sourceNode = ctx.createBufferSource()
      sourceNode.buffer = buffer
      sourceNode.connect(ctx.destination)

      const now = ctx.currentTime
      const startTime = Math.max(now, nextPlayTimeRef.current)
      sourceNode.start(startTime)
      nextPlayTimeRef.current = startTime + buffer.duration

      setCallState('speaking')
      sourceNode.onended = () => {
        if (audioContextRef.current && audioContextRef.current.currentTime >= nextPlayTimeRef.current - 0.05) {
          setCallState('listening')
        }
      }
    } catch (err) {
      console.error('Audio playback error:', err)
    }
  }, [])

  const stopMicrophone = useCallback(() => {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach(t => t.stop())
      micStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
  }, [])

  const startMicrophone = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      micStreamRef.current = stream
      const audioContext = new AudioContext({ sampleRate: sampleRateRef.current })
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)

      const silentGain = audioContext.createGain()
      silentGain.gain.value = 0
      silentGain.connect(audioContext.destination)

      const processor = audioContext.createScriptProcessor(4096, 1, 1)
      processorRef.current = processor
      source.connect(processor)
      processor.connect(silentGain)

      processor.onaudioprocess = (e) => {
        if (isMutedRef.current) return
        const inputData = e.inputBuffer.getChannelData(0)
        const pcm16 = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          pcm16[i] = Math.max(-32768, Math.min(32767, Math.floor(inputData[i] * 32768)))
        }
        const base64 = btoa(String.fromCharCode(...new Uint8Array(pcm16.buffer)))
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'audio',
            audio: base64,
            sampleRate: sampleRateRef.current,
          }))
        }
      }
    } catch (err) {
      console.error('Microphone access error:', err)
      setStatusMsg('Could not access microphone. Please check permissions.')
    }
  }, [])

  const startVoiceSession = useCallback(async () => {
    setCallState('connecting')
    setStatusMsg('')
    setTranscripts([])
    nextPlayTimeRef.current = 0

    try {
      const res = await fetch('https://voice-sip.studio.lyzr.ai/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agentId: VOICE_AGENT_ID }),
      })

      if (!res.ok) {
        throw new Error('Failed to start voice session')
      }

      const data = await res.json()
      const wsUrl = data?.wsUrl
      const sampleRate = data?.audioConfig?.sampleRate || 24000

      if (!wsUrl) {
        throw new Error('No WebSocket URL received')
      }

      sampleRateRef.current = sampleRate

      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        setCallState('listening')
        startMicrophone()
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg.type === 'audio') {
            playAudioChunk(msg.audio)
          } else if (msg.type === 'transcript') {
            addTranscript(msg)
          } else if (msg.type === 'thinking') {
            setCallState('processing')
          } else if (msg.type === 'clear') {
            nextPlayTimeRef.current = 0
          } else if (msg.type === 'error') {
            console.error('Voice error:', msg)
            setStatusMsg(typeof msg?.message === 'string' ? msg.message : 'An error occurred during the call.')
          }
        } catch {
          // ignore parse errors on non-JSON messages
        }
      }

      ws.onerror = () => {
        setStatusMsg('Connection error. Please try again.')
        setCallState('idle')
        stopMicrophone()
      }

      ws.onclose = () => {
        setCallState('idle')
        stopMicrophone()
      }
    } catch (err) {
      console.error('Voice session error:', err)
      setStatusMsg('Failed to start voice session. Please try again.')
      setCallState('idle')
    }
  }, [startMicrophone, stopMicrophone, playAudioChunk, addTranscript])

  const endCall = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
    stopMicrophone()
    nextPlayTimeRef.current = 0
    setCallState('idle')
  }, [stopMicrophone])

  const toggleMute = useCallback(() => {
    setIsMuted(prev => !prev)
  }, [])

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      stopMicrophone()
    }
  }, [stopMicrophone])

  const stateLabels: Record<CallState, string> = {
    idle: 'Ready',
    connecting: 'Connecting...',
    listening: 'Listening...',
    processing: 'Processing...',
    speaking: 'Agent Speaking...',
  }

  return (
    <div className="flex flex-col h-full">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Voice Support</h1>
        <p className="text-sm text-muted-foreground mt-1">Speak with our AI support agent</p>
      </div>

      <div className="flex-1 flex flex-col lg:flex-row gap-6 mt-6">
        <div className={`${glassCard} flex-1 flex flex-col items-center justify-center p-8`}>
          <VoicePulse state={callState} />

          <p className={`mt-6 text-sm font-medium ${callState === 'idle' ? 'text-muted-foreground' : callState === 'speaking' ? 'text-amber-600' : callState === 'processing' ? 'text-purple-600' : 'text-emerald-600'}`}>
            {stateLabels[callState]}
          </p>

          {statusMsg && (
            <p className="mt-2 text-xs text-destructive flex items-center gap-1"><RiAlertLine className="w-3 h-3" /> {statusMsg}</p>
          )}

          <div className="flex items-center gap-4 mt-8">
            {callState === 'idle' ? (
              <Button onClick={startVoiceSession} className="bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 rounded-full px-8 py-3 text-sm font-semibold shadow-lg shadow-emerald-500/20 transition-all duration-300 hover:shadow-xl">
                <RiPhoneFill className="w-5 h-5 mr-2" /> Start Voice Call
              </Button>
            ) : (
              <>
                <Button
                  variant={isMuted ? 'destructive' : 'outline'}
                  size="lg"
                  className="rounded-full w-14 h-14 p-0"
                  onClick={toggleMute}
                  disabled={callState === 'connecting'}
                >
                  {isMuted ? <RiMicOffLine className="w-6 h-6" /> : <RiMicLine className="w-6 h-6" />}
                </Button>
                <Button
                  variant="destructive"
                  size="lg"
                  className="rounded-full w-14 h-14 p-0"
                  onClick={endCall}
                >
                  <RiPhoneOffLine className="w-6 h-6" />
                </Button>
              </>
            )}
          </div>
        </div>

        <div className={`${glassCard} lg:w-80 flex flex-col`}>
          <button
            onClick={() => setShowTranscripts(!showTranscripts)}
            className="flex items-center justify-between w-full px-5 py-4 text-left"
          >
            <div className="flex items-center gap-2">
              <RiVoiceprintLine className="w-4 h-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">Live Transcript</h3>
            </div>
            <RiArrowDownSLine className={`w-4 h-4 text-muted-foreground transition-transform ${showTranscripts ? 'rotate-180' : ''}`} />
          </button>

          {showTranscripts && (
            <div ref={transcriptScrollRef} className="flex-1 overflow-y-auto px-5 pb-4 space-y-3 max-h-[400px]">
              {transcripts.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <RiVoiceprintLine className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">{callState === 'idle' ? 'Start a call to see live transcripts' : 'Listening for speech...'}</p>
                </div>
              ) : (
                transcripts.map(t => (
                  <div key={t.id} className={`p-3 rounded-xl text-xs ${t.role === 'user' ? 'bg-primary/10 text-foreground ml-4' : 'bg-secondary text-foreground mr-4'}`}>
                    <p className="font-medium text-[10px] text-muted-foreground mb-1">{t.role === 'user' ? 'You' : 'Agent'}</p>
                    <p>{t.text}</p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ---- Conversations History View ----
function HistoryView({ conversations }: { conversations: ConversationRecord[] }) {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const filtered = conversations.filter(c => {
    if (filter === 'chat' && c.channel !== 'chat') return false
    if (filter === 'voice' && c.channel !== 'voice') return false
    if (search) {
      const s = search.toLowerCase()
      return c.customerName.toLowerCase().includes(s) || c.subject.toLowerCase().includes(s) || (c.ticketId || '').toLowerCase().includes(s)
    }
    return true
  })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Conversations</h1>
        <p className="text-sm text-muted-foreground mt-1">Review past chat and voice interactions</p>
      </div>

      <div className={`${glassCard} p-4 flex flex-col sm:flex-row gap-4`}>
        <Tabs value={filter} onValueChange={setFilter} className="w-auto">
          <TabsList className="rounded-xl">
            <TabsTrigger value="all" className="text-xs rounded-lg">All</TabsTrigger>
            <TabsTrigger value="chat" className="text-xs rounded-lg">Chat</TabsTrigger>
            <TabsTrigger value="voice" className="text-xs rounded-lg">Voice</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex-1 relative">
          <RiSearchLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search conversations..."
            className="pl-9 rounded-xl text-sm"
          />
        </div>
      </div>

      <div className={`${glassCard} overflow-hidden`}>
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <RiHistoryLine className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No conversations found. {conversations.length === 0 ? 'Enable sample data to see demo conversations.' : 'Try adjusting your filters.'}</p>
          </div>
        ) : (
          <div className="divide-y divide-border/50">
            {filtered.map(conv => (
              <div key={conv.id}>
                <button
                  onClick={() => setExpandedId(expandedId === conv.id ? null : conv.id)}
                  className="w-full flex items-center gap-4 p-4 hover:bg-secondary/30 transition-colors text-left"
                >
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${conv.channel === 'chat' ? 'bg-emerald-100' : 'bg-amber-100'}`}>
                    {conv.channel === 'chat' ? <RiChat3Line className="w-4 h-4 text-emerald-600" /> : <RiPhoneLine className="w-4 h-4 text-amber-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{conv.customerName}</p>
                      <StatusBadge status={conv.status} />
                      {conv.ticketId && (
                        <Badge variant="outline" className="text-[10px] font-mono bg-primary/5 text-primary border-primary/20">{conv.ticketId}</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.subject}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-muted-foreground">{timeAgo(conv.date)}</p>
                    <p className="text-xs text-muted-foreground">{conv.channel === 'chat' ? `${conv.messageCount} msgs` : conv.duration}</p>
                  </div>
                  <RiArrowDownSLine className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${expandedId === conv.id ? 'rotate-180' : ''}`} />
                </button>

                {expandedId === conv.id && (
                  <div className="px-6 pb-4 pt-0">
                    <Separator className="mb-4" />
                    <div className="space-y-3 pl-4 border-l-2 border-primary/20">
                      {Array.isArray(conv.messages) && conv.messages.map((m, mi) => (
                        <div key={mi} className="text-sm">
                          <p className="text-xs font-medium text-muted-foreground mb-0.5">{m.role === 'user' ? 'Customer' : 'Agent'}</p>
                          <p className="text-foreground">{m.text}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ---- Knowledge Base View ----
function KBView() {
  const { documents, loading, error, fetchDocuments, uploadDocument, removeDocuments, crawlSite } = useRAGKnowledgeBase()
  const [crawlUrl, setCrawlUrl] = useState('')
  const [operationStatus, setOperationStatus] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [hasFetched, setHasFetched] = useState(false)

  useEffect(() => {
    if (!hasFetched) {
      fetchDocuments(RAG_ID)
      setHasFetched(true)
    }
  }, [hasFetched, fetchDocuments])

  const handleUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setOperationStatus('')
    const result = await uploadDocument(RAG_ID, file)
    if (result.success) {
      setOperationStatus(`"${file.name}" uploaded and trained successfully.`)
    } else {
      setOperationStatus(`Upload failed: ${result.error || 'Unknown error'}`)
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [uploadDocument])

  const handleDelete = useCallback(async (fileName: string) => {
    setOperationStatus('')
    const result = await removeDocuments(RAG_ID, [fileName])
    if (result.success) {
      setOperationStatus(`"${fileName}" deleted successfully.`)
    } else {
      setOperationStatus(`Delete failed: ${result.error || 'Unknown error'}`)
    }
  }, [removeDocuments])

  const handleCrawl = useCallback(async () => {
    if (!crawlUrl.trim()) return
    setOperationStatus('')
    const result = await crawlSite(RAG_ID, crawlUrl.trim())
    if (result.success) {
      setOperationStatus(`Website crawled and added to knowledge base.`)
      setCrawlUrl('')
      fetchDocuments(RAG_ID)
    } else {
      setOperationStatus(`Crawl failed: ${result.error || 'Unknown error'}`)
    }
  }, [crawlUrl, crawlSite, fetchDocuments])

  const docs = Array.isArray(documents) ? documents : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Knowledge Base</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage documents that power your support agents</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className={glassCard}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <RiUploadCloud2Line className="w-4 h-4 text-primary" /> Upload Document
            </CardTitle>
            <CardDescription className="text-xs">PDF, DOCX, or TXT files</CardDescription>
          </CardHeader>
          <CardContent>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt"
              onChange={handleUpload}
              className="hidden"
              id="kb-upload"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={loading}
              className="w-full rounded-xl border-dashed border-2 py-8 flex flex-col gap-2 h-auto"
            >
              {loading ? <RiLoader4Line className="w-6 h-6 animate-spin text-primary" /> : <RiUploadCloud2Line className="w-6 h-6 text-muted-foreground" />}
              <span className="text-xs text-muted-foreground">{loading ? 'Uploading...' : 'Click to upload a file'}</span>
            </Button>
          </CardContent>
        </Card>

        <Card className={glassCard}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <RiGlobalLine className="w-4 h-4 text-primary" /> Crawl Website
            </CardTitle>
            <CardDescription className="text-xs">Add website content to the knowledge base</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={crawlUrl}
              onChange={e => setCrawlUrl(e.target.value)}
              placeholder="https://example.com/docs"
              className="rounded-xl text-sm"
            />
            <Button onClick={handleCrawl} disabled={loading || !crawlUrl.trim()} className="w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90">
              {loading ? <RiLoader4Line className="w-4 h-4 mr-2 animate-spin" /> : <RiGlobalLine className="w-4 h-4 mr-2" />}
              Crawl and Add
            </Button>
          </CardContent>
        </Card>
      </div>

      {operationStatus && (
        <div className={`${glassCard} p-4 text-sm ${operationStatus.toLowerCase().includes('failed') || operationStatus.toLowerCase().includes('error') ? 'text-destructive' : 'text-emerald-700'}`}>
          <p className="flex items-center gap-2">
            {operationStatus.toLowerCase().includes('failed') || operationStatus.toLowerCase().includes('error')
              ? <RiAlertLine className="w-4 h-4 shrink-0" />
              : <RiCheckboxCircleLine className="w-4 h-4 shrink-0" />}
            {operationStatus}
          </p>
        </div>
      )}
      {error && (
        <div className={`${glassCard} p-4 text-sm text-destructive`}>
          <p className="flex items-center gap-2"><RiAlertLine className="w-4 h-4 shrink-0" /> {error}</p>
        </div>
      )}

      <Card className={glassCard}>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <RiDatabase2Line className="w-4 h-4 text-primary" /> Documents ({docs.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading && docs.length === 0 ? (
            <div className="text-center py-8">
              <RiLoader4Line className="w-8 h-8 mx-auto mb-2 animate-spin text-primary" />
              <p className="text-xs text-muted-foreground">Loading documents...</p>
            </div>
          ) : docs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <RiFileTextLine className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p className="text-xs">No documents in the knowledge base yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map((doc, idx) => (
                <div key={doc.id || idx} className="flex items-center gap-3 p-3 rounded-xl bg-secondary/50 hover:bg-secondary transition-colors">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                    <RiFileTextLine className="w-4 h-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{doc.fileName}</p>
                    <p className="text-xs text-muted-foreground">{doc.fileType?.toUpperCase() || 'FILE'}{doc.status ? ` - ${doc.status}` : ''}</p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(doc.fileName)}
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                    disabled={loading}
                  >
                    <RiDeleteBinLine className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---- Agent Info ----
function AgentInfoSection({ activeAgentId }: { activeAgentId: string | null }) {
  const agents = [
    { id: CHAT_AGENT_ID, name: 'Chat Support Agent', type: 'JSON', desc: 'Text-based support with KB' },
    { id: VOICE_AGENT_ID, name: 'Voice Support Agent', type: 'Voice', desc: 'Voice-based customer support' },
  ]

  return (
    <div className={`${glassCard} p-4`}>
      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Agents</h4>
      <div className="space-y-2">
        {agents.map(a => (
          <div key={a.id} className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full shrink-0 ${activeAgentId === a.id ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/30'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-foreground truncate">{a.name}</p>
              <p className="text-[10px] text-muted-foreground">{a.type} - {a.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ======== MAIN PAGE ========
export default function Page() {
  const [activeView, setActiveView] = useState<ActiveView>('dashboard')
  const [sampleData, setSampleData] = useState(false)
  const [conversations] = useState<ConversationRecord[]>(getMockConversations)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  const [sessionId] = useState<string | null>(null)
  const [showActivityPanel, setShowActivityPanel] = useState(false)

  const agentActivity = useLyzrAgentEvents(sessionId)

  useEffect(() => {
    if (activeView === 'chat') {
      setActiveAgentId(CHAT_AGENT_ID)
    } else if (activeView === 'voice') {
      setActiveAgentId(VOICE_AGENT_ID)
    } else {
      setActiveAgentId(null)
    }
  }, [activeView])

  const navItems: { key: ActiveView; label: string; icon: React.ReactNode }[] = [
    { key: 'dashboard', label: 'Dashboard', icon: <RiDashboardLine className="w-5 h-5" /> },
    { key: 'chat', label: 'Chat', icon: <RiChat3Line className="w-5 h-5" /> },
    { key: 'voice', label: 'Voice', icon: <RiPhoneLine className="w-5 h-5" /> },
    { key: 'history', label: 'Conversations', icon: <RiHistoryLine className="w-5 h-5" /> },
  ]

  return (
    <div
      className="flex h-screen overflow-hidden"
      style={{ background: 'linear-gradient(135deg, hsl(160 40% 94%) 0%, hsl(180 35% 93%) 30%, hsl(160 35% 95%) 60%, hsl(140 40% 94%) 100%)' }}
    >
      {/* Sidebar */}
      <aside className="w-64 shrink-0 flex flex-col h-full p-4 backdrop-blur-[16px] bg-white/75 border-r border-white/[0.18] shadow-md">
        <div className="flex items-center gap-3 px-4 py-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <RiCustomerService2Fill className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-foreground tracking-tight">OmniServe</h1>
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Customer Service</p>
          </div>
        </div>

        <nav className="space-y-1 flex-1">
          {navItems.map(item => (
            <NavItem
              key={item.key}
              icon={item.icon}
              label={item.label}
              active={activeView === item.key}
              onClick={() => setActiveView(item.key)}
            />
          ))}
        </nav>

        <div className="mt-auto space-y-3">
          <NavItem
            icon={<RiDatabase2Line className="w-5 h-5" />}
            label="Knowledge Base"
            active={activeView === 'kb'}
            onClick={() => setActiveView('kb')}
          />

          <Separator className="opacity-50" />

          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-muted-foreground font-medium">Sample Data</span>
            <button
              onClick={() => setSampleData(!sampleData)}
              className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${sampleData ? 'bg-primary' : 'bg-muted'}`}
              aria-label="Toggle sample data"
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${sampleData ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <div className="flex items-center justify-between px-4 py-2">
            <span className="text-xs text-muted-foreground font-medium">Agent Activity</span>
            <button
              onClick={() => setShowActivityPanel(!showActivityPanel)}
              className={`relative w-10 h-5 rounded-full transition-colors duration-200 ${showActivityPanel ? 'bg-primary' : 'bg-muted'}`}
              aria-label="Toggle agent activity panel"
            >
              <div className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform duration-200 ${showActivityPanel ? 'translate-x-5' : ''}`} />
            </button>
          </div>

          <AgentInfoSection activeAgentId={activeAgentId} />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 overflow-y-auto p-8">
            {activeView === 'dashboard' && (
              <DashboardView onNavigate={setActiveView} sampleData={sampleData} conversations={conversations} />
            )}
            {activeView === 'chat' && <ChatView sampleData={sampleData} />}
            {activeView === 'voice' && <VoiceView />}
            {activeView === 'history' && <HistoryView conversations={sampleData ? conversations : []} />}
            {activeView === 'kb' && <KBView />}
          </div>

          {showActivityPanel && (
            <div className="w-80 shrink-0 border-l border-border/50 h-full overflow-hidden">
              <AgentActivityPanel
                isConnected={agentActivity.isConnected}
                events={agentActivity.events}
                thinkingEvents={agentActivity.thinkingEvents}
                lastThinkingMessage={agentActivity.lastThinkingMessage}
                activeAgentId={agentActivity.activeAgentId}
                activeAgentName={agentActivity.activeAgentName}
                isProcessing={agentActivity.isProcessing}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
