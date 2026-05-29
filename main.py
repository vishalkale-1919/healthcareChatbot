import os
import time
import uuid  # Used to generate unique local storage IDs for ChromaDB
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv
from google import genai
from google.genai import types
from google.genai.errors import APIError
import chromadb  # Import local storage Vector DB

load_dotenv()
print("GEMINI API KEY LOADED:", os.getenv("GEMINI_API_KEY") is not None) 

app = Flask(__name__)

# Initialize the standard Google GenAI Client
client = genai.Client()

# ── CHROMADB LOCAL INITIALIZATION ───────────────────────────────────────
# This creates a folder named 'chroma_db' on your computer's personal hard drive
chroma_client = chromadb.PersistentClient(path="./chroma_db")
chat_collection = chroma_client.get_or_create_collection(name="senior_chat_history")
# ────────────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are a compassionate, knowledgeable healthcare assistant specifically designed 
to help elderly people (aged 60+) and their caregivers.

Guidelines:
- Use simple, clear language. Avoid complex medical jargon.
- Be warm, patient, and reassuring in tone.
- Provide practical, actionable advice.
- Always remind users to consult their doctor for serious concerns.
- Focus on common elderly health topics: medications, chronic conditions (diabetes, hypertension, 
  arthritis, dementia), nutrition, mobility, mental health, sleep, fall prevention, eye/ear care.
- Keep responses concise (3-5 sentences) but helpful.
- If someone describes an emergency symptom (chest pain, sudden numbness, difficulty breathing), 
  urgently advise them to call emergency services immediately.
- Be encouraging and positive about healthy aging."""


@app.route("/")
def index():
    return render_template("index.html")

# ── NEW ROUTE: FETCH ALL HISTORICAL CONVERSATIONS FOR SIDEBAR ──────────
@app.get("/api/history")
def get_all_history():
    try:
        # Pull everything out of the local collection
        results = chat_collection.get(include=["documents", "metadatas"])
        
        documents = results.get("documents", [])
        metadatas = results.get("metadatas", [])
        
        # Group messages together by their session timestamp
        sessions = {}
        for doc, meta in zip(documents, metadatas):
            ts = meta.get("timestamp")
            role = meta.get("role")
            
            if not ts:
                continue
                
            if ts not in sessions:
                sessions[ts] = {"timestamp": ts, "preview": "", "messages": []}
            
            sessions[ts]["messages"].append({"role": role, "content": doc})
            
            # Use the very first user message as the text title/preview for the sidebar button
            if role == "user" and not sessions[ts]["preview"]:
                sessions[ts]["preview"] = doc[:30] + "..." if len(doc) > 30 else doc

        # Sort sessions so the most recent chats appear at the top of the sidebar
        sorted_sessions = sorted(sessions.values(), key=lambda x: float(x["timestamp"]), reverse=True)
        return jsonify({"sessions": sorted_sessions})
    except Exception as e:
        print(f"HISTORY FETCH ERROR: {e}")
        return jsonify({"sessions": []}), 500


@app.route("/chat", methods=["POST"])
def chat():
    data = request.get_json()
    history = data.get("history", [])

    session_timestamp = data.get("timestamp", str(time.time()))

    if not history:
        return jsonify({"error": "No messages provided"}), 400

    # Grab the absolute newest message text from the user to store in ChromaDB
    latest_user_message = history[-1].get("content", "")

    # Map your existing user/assistant payload list into the expected Google API structures
    formatted_contents = []
    for message in history:
        role = "user" if message.get("role") == "user" else "model"
        formatted_contents.append(
            types.Content(
                role=role,
                parts=[types.Part.from_text(text=message.get("content", ""))]
            )
        )

    # Build out configuration parameters
    config = types.GenerateContentConfig(
        system_instruction=SYSTEM_PROMPT,
        temperature=0.3,
        max_output_tokens=1000
    )

    # Models to try sequentially to safeguard your application from 503 traffic spikes
    models_to_try = ["gemini-3.5-flash", "gemini-2.5-flash"]
    
    for current_model in models_to_try:
        try:
            print(f"Connecting to Gemini via model cluster: {current_model}")
            response = client.models.generate_content(
                model=current_model,
                contents=formatted_contents,
                config=config
            )
            
            ai_reply = response.text

            # ── SAVE TO LOCAL STORAGE (CHROMADB) ─────────────────────────────
            # Generate a clean shared timestamp for the pair
            #current_timestamp = str(time.time())
            
            # Write User Message into local drive partition
            chat_collection.add(
                documents=[latest_user_message],
                metadatas=[{"role": "user", "timestamp": session_timestamp}],
                ids=[f"user_{uuid.uuid4()}"]
            )
            
            # Write AI generated answer into local drive partition
            chat_collection.add(
                documents=[ai_reply],
                metadatas=[{"role": "bot", "timestamp": session_timestamp}],
                ids=[f"bot_{uuid.uuid4()}"]
            )
            # ─────────────────────────────────────────────────────────────────
            
            return jsonify({"reply": ai_reply})

        except APIError as e:
            if e.code == 503:
                print(f"Warning: {current_model} cluster busy. Dropping to fallback...")
                time.sleep(1)  # Brief delay to allow network congestion to shift
                continue
            else:
                print(f"GEMINI API ERROR: {e}")
                return jsonify({"error": f"API Error: {e.message}"}), e.code
        except Exception as e:
            print(f"SYSTEM ENGINE ERROR: {e}")
            return jsonify({"error": str(e)}), 500

    return jsonify({
        "reply": "I'm sorry, my health analytics servers are exceptionally busy right now. Please wait a brief moment and try again!"
    }), 503


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))