# Transcript Debugging Guide

## What Was Fixed

### 1. Enhanced Logging System
Added comprehensive console logging throughout the transcript pipeline to track:
- When transcript events are received from OpenAI's Realtime API
- When transcripts are being saved to the database
- Session configuration confirmation
- Database insertion success/failure

### 2. Error Visibility
- Database errors now appear in the error state and are logged to console
- Failed transcript saves are clearly reported
- Session ID validation before message insertion

### 3. Live Transcript Debug Display
- Added a yellow debug banner that shows transcripts as they're being generated
- Helps verify that the OpenAI API is sending transcript data
- Clears automatically when transcript is completed

### 4. Database Schema Verification
- Confirmed the database schema is correct (timestamp field exists)
- Verified no messages are currently being saved (found active sessions but zero messages)

## How to Test

### Step 1: Open Browser Console
1. Start the voice agent
2. Open Developer Tools (F12 or Cmd+Option+I)
3. Go to the Console tab

### Step 2: Look for These Console Messages

**When connection is established:**
```
✅ Session updated successfully
📋 Session config: {modalities, inputTranscription, turnDetection}
```

**When you speak:**
```
📝 User transcript delta: [your words as you speak]
✅ USER TRANSCRIPT COMPLETED: [full transcript]
🗣️ USER said: [full transcript]
💾 Attempting to save user message: [transcript preview]
✅ Message saved successfully: [message ID]
```

**When assistant responds:**
```
📝 ASSISTANT TRANSCRIPT DELTA: [assistant's words]
✅ ASSISTANT TRANSCRIPT COMPLETED: [full response]
🗣️ ASSISTANT said: [full response]
💾 Attempting to save assistant message: [response preview]
✅ Message saved successfully: [message ID]
```

### Step 3: Visual Indicators

**On the UI:**
- A yellow "Live Transcript" banner should appear below the microphone showing real-time transcription
- Messages should appear in the right-hand conversation panel
- If errors occur, they will appear in a red box

### Step 4: Check Database

After testing, verify messages were saved:
```sql
SELECT role, content, timestamp FROM va_messages ORDER BY timestamp DESC LIMIT 10;
```

## Troubleshooting

### If you see NO transcript logs at all:

**Problem:** OpenAI API isn't sending transcription events
**Check:**
1. Look for "📤 Sending session.update with transcription enabled"
2. Verify it shows `hasTranscription: true`
3. Check if session.updated shows input_audio_transcription in the config

**Solution:** The input_audio_transcription might not be supported or API key might be invalid

### If you see transcript logs but NO "💾 Attempting to save":

**Problem:** Transcript events aren't reaching the handler
**Check:**
1. Verify the transcript isn't empty
2. Look for "⚠️ Empty transcript received, skipping"

**Solution:** The OpenAI API might be sending empty transcripts

### If you see "💾 Attempting to save" but "❌ Failed to add message":

**Problem:** Database insertion is failing
**Check:**
1. Look for the specific error message after the ❌
2. Common issues:
   - Session ID is null
   - Database connection failed
   - Foreign key constraint violation

**Solution:** Check Supabase connection and verify session was created

### If transcripts appear in console but not in UI:

**Problem:** Messages are being saved but not displayed
**Check:**
1. Verify "✅ Message saved successfully" appears
2. Check if React state is updating (messages array)

**Solution:** This would be a React state management issue

## Expected Behavior

With these changes, you should see:

1. **Real-time feedback**: Yellow banner shows transcript as you speak
2. **Console confirmation**: Every step is logged with emojis for easy scanning
3. **Error visibility**: Any failures are immediately visible
4. **Message persistence**: Transcripts saved to database and displayed in UI

## Next Steps

1. Start a new voice session
2. Speak a simple phrase like "Hello, can you hear me?"
3. Watch the console logs carefully
4. Check which step succeeds and which fails
5. Share the console output if transcripts still aren't appearing

The logs will tell us exactly where the transcript data is getting lost in the pipeline.
