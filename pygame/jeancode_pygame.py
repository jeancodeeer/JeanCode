#!/usr/bin/env python3
"""JeanCode en pygame.   pip install pygame   y luego   python jeancode_pygame.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from jeancode.app import main  # noqa: E402

main()
