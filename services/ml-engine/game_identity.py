"""Shared game identity excludes annotations and export-specific metadata."""
import hashlib
import json
import unicodedata

def normalized(name):
    return ' '.join(unicodedata.normalize('NFKC', name).casefold().split())

def participant_identity(headers, side):
    fide=headers.get(side+'FideId','').strip()
    return 'fide:'+fide if fide.isdigit() and int(fide)>0 else 'name:'+normalized(headers.get(side,'Unknown'))

def game_identity(game):
    value=[participant_identity(game.headers,'White'),participant_identity(game.headers,'Black'),
        game.headers.get('Date','????.??.??'),game.headers.get('Round','?'),
        game.board().fen(),[move.uci() for move in game.mainline_moves()]]
    return hashlib.sha256(json.dumps(value,ensure_ascii=False).encode()).hexdigest()
