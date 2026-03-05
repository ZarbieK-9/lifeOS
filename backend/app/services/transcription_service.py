"""Audio transcription service — accepts audio bytes, returns text.

Uses Google Cloud Speech-to-Text for transcription.
Falls back to returning an error if the service is not configured.
"""

import logging
import os

logger = logging.getLogger("lifeos.transcription")


async def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/m4a") -> str:
    """
    Transcribe audio bytes to text using Google Cloud Speech-to-Text.

    Args:
        audio_bytes: Raw audio data
        content_type: MIME type of the audio (default: audio/m4a from expo-av)

    Returns:
        Transcribed text string

    Raises:
        RuntimeError: If STT service is not configured
    """
    # Try Google Cloud Speech-to-Text
    try:
        from google.cloud import speech

        client = speech.SpeechClient()

        # Map content types to encoding
        encoding_map = {
            "audio/m4a": speech.RecognitionConfig.AudioEncoding.MP4_AUDIO,
            "audio/mp4": speech.RecognitionConfig.AudioEncoding.MP4_AUDIO,
            "audio/wav": speech.RecognitionConfig.AudioEncoding.LINEAR16,
            "audio/webm": speech.RecognitionConfig.AudioEncoding.WEBM_OPUS,
        }
        encoding = encoding_map.get(
            content_type, speech.RecognitionConfig.AudioEncoding.ENCODING_UNSPECIFIED
        )

        audio = speech.RecognitionAudio(content=audio_bytes)
        config = speech.RecognitionConfig(
            encoding=encoding,
            sample_rate_hertz=44100,
            language_code=os.getenv("STT_LANGUAGE", "en-US"),
            enable_automatic_punctuation=True,
        )

        response = client.recognize(config=config, audio=audio)

        texts = [
            result.alternatives[0].transcript
            for result in response.results
            if result.alternatives
        ]
        transcript = " ".join(texts).strip()

        if not transcript:
            logger.warning("Transcription returned empty result")
            return ""

        logger.info(f"Transcribed {len(audio_bytes)} bytes → {len(transcript)} chars")
        return transcript

    except ImportError:
        logger.error("google-cloud-speech not installed")
        raise RuntimeError(
            "Speech-to-text not configured. Install google-cloud-speech."
        )
    except Exception as e:
        logger.error(f"Transcription failed: {e}")
        raise RuntimeError(f"Transcription failed: {e}")
