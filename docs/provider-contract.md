# Custom HTTP Provider Contract

`custom-http` is the bridge format for plugging a local agent service into the discussion app.

## Request

The backend sends `POST {endpoint}` with JSON like this:

```json
{
  "room": {
    "id": "room-id",
    "title": "Reviewer vs Advisor",
    "topic": "Discuss whether a proposal is defensible.",
    "objective": "Force the discussion toward a useful verdict.",
    "maxRounds": 4,
    "checkpointEveryRound": true,
    "roles": [],
    "messages": [
      {
        "roleName": "You",
        "kind": "user",
        "content": "New evidence: the pilot already shows an effect."
      }
    ],
    "summary": {
      "insights": []
    },
    "state": {
      "status": "running",
      "currentRound": 2
    }
  },
  "role": {
    "id": "role-id",
    "name": "Reviewer",
    "kind": "participant",
    "persona": "A strict reviewer",
    "principles": "Attack weak assumptions and weak validation",
    "voiceStyle": "Short and direct",
    "goal": "Reject the proposal unless it becomes defensible",
    "accentColor": "#8b3d3d",
    "enabled": true,
    "provider": {
      "type": "custom-http",
      "model": "bridge-model",
      "endpoint": "http://127.0.0.1:8000/chat",
      "apiKey": "",
      "temperature": 0.7,
      "maxTokens": 320
    }
  },
  "prompt": {
    "system": "Role-specific system prompt",
    "user": "Latest round context and transcript",
    "finalMode": false
  }
}
```

## Response

Return any one of these fields:

```json
{ "content": "The role's next short message." }
```

```json
{ "message": "The role's next short message." }
```

```json
{ "output": "The role's next short message." }
```

Optional targeted reply metadata is also supported:

```json
{ "content": "This evidence still does not clear the acceptance bar.", "replyToMessageId": "message-id" }
```

The app trims the response into a short chat-style turn. If `replyToMessageId` is omitted, the message is still accepted.

## Behavioral Expectations

- Participants should reply with 1 to 3 short sentences
- Participants should react to the latest objections, evidence, and any user intervention
- The latest user-supplied evidence should be treated as the highest-priority signal in the next turn
- If a participant returns `replyToMessageId`, the content should actually address that message's claim or evidence
- Recorder roles should output concise checkpoint notes or a compact final conclusion
- Avoid markdown lists unless absolutely necessary
- Avoid repeating earlier turns word-for-word
