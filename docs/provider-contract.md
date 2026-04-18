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
    "documentAsset": {
      "id": "document-id",
      "fileName": "paper.pdf",
      "fileKind": "pdf",
      "title": "Paper Title"
    },
    "documentDiscussionMode": "selected-segments",
    "selectedDocumentSegmentIds": ["segment-3"],
    "documentSummary": {
      "title": "Paper Title",
      "abstract": "Short extracted abstract",
      "defaultTopic": "Discuss the selected section of the paper."
    },
    "documentSegments": [
      {
        "id": "segment-3",
        "title": "Method",
        "content": "Selected section text",
        "path": ["Method"],
        "pageStart": 3,
        "pageEnd": 4
      }
    ],
    "messages": [
      {
        "roleName": "You",
        "kind": "user",
        "content": "New evidence: the pilot already shows an effect.",
        "requiredReplyRoleId": "reviewer-role-id",
        "requiredReplyRoleName": "Reviewer"
      }
    ],
    "summary": {
      "insights": []
    },
    "state": {
      "status": "running",
      "currentRound": 2,
      "spokenParticipantRoleIds": ["advisor-role-id"],
      "pendingRequiredReplies": [
        {
          "sourceMessageId": "user-message-id",
          "targetRoleId": "reviewer-role-id",
          "targetRoleName": "Reviewer",
          "reason": "user-direct-reply",
          "createdAt": "2026-04-19T00:00:00.000Z"
        }
      ]
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

Optional targeted reply metadata and directed follow-up metadata are also supported:

```json
{
  "content": "This evidence still does not clear the acceptance bar.",
  "replyToMessageId": "message-id",
  "forceReplyRoleId": "participant-role-id"
}
```

The app trims the response into a short chat-style turn.

- If `replyToMessageId` is omitted, the message is still accepted.
- If `forceReplyRoleId` is omitted or invalid, it is ignored.
- When the backend is fulfilling a mandatory directed reply, it will override `replyToMessageId` to the required source message and ignore any returned `forceReplyRoleId`.

## Behavioral Expectations

- Participants should reply with 1 to 3 short sentences
- Participants should react to the latest objections, evidence, and any user intervention
- If the room includes document context, participants should use the selected document material as evidence instead of ignoring it
- The latest user-supplied evidence should be treated as the highest-priority signal in the next turn
- If a participant returns `replyToMessageId`, the content should actually address that message's claim or evidence
- If a participant returns `forceReplyRoleId`, it should only be used when another participant must directly answer that claim next
- Recorder roles should output concise checkpoint notes or a compact final conclusion
- Avoid markdown lists unless absolutely necessary
- Avoid repeating earlier turns word-for-word
