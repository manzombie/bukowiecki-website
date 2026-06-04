# VFX Tools - Deployment Guide

This directory contains the VFX Tools interface for bukowiecki.co. These files are ready to be deployed to your domain under the `/vfxtools` subdirectory.

## File Structure

```
vfxtools/
├── index.html              # Main VFX Tools landing page
├── subcap-converter.html   # Subcaps to Locators Converter tool
├── styles.css             # Shared CSS stylesheet
└── README.md              # This deployment guide
```

## Deployment Instructions

### 1. Upload Files to Your Domain

Upload all files in the `vfxtools/` directory to your web server under the `/vfxtools` path:

```
https://bukowiecki.co/vfxtools/
├── index.html
├── subcap-converter.html
├── styles.css
└── README.md
```

### 2. File Permissions

Ensure the following file permissions:
- HTML files: 644 (readable by web server)
- CSS files: 644 (readable by web server)
- Directories: 755 (executable by web server)

### 3. Testing

After deployment, test the following URLs:

1. **Main VFX Tools page**: `https://bukowiecki.co/vfxtools/`
2. **Subcap Converter tool**: `https://bukowiecki.co/vfxtools/subcap-converter.html`

### 4. Features Included

#### Main Landing Page (`index.html`)
- Professional design matching bukowiecki.co aesthetic
- Grid layout showcasing available tools
- Navigation back to main site
- Placeholder cards for future tools
- Responsive design for mobile devices

#### Subcap Converter Tool (`subcap-converter.html`)
- **Multi-frame rate support**: 23.976, 24, 25, 29.97, 30, 50, 59.94, 60fps
- Drag & drop file upload
- Real-time conversion with preview
- Download converted files with frame rate suffix
- Error handling and status messages
- Professional styling with frame rate selector

#### Shared Stylesheet (`styles.css`)
- Modern CSS with CSS custom properties
- Responsive design system
- Consistent color scheme matching your brand
- Smooth animations and transitions
- Mobile-first approach
- Styled form controls for frame rate selection

## Supported Frame Rates

The Subcap Converter now supports all major professional frame rates:

- **23.976 fps** - Standard film frame rate (24p pulldown)
- **24 fps** - Standard film frame rate
- **25 fps** - PAL standard frame rate
- **29.97 fps** - NTSC standard frame rate (30p pulldown)
- **30 fps** - NTSC standard frame rate
- **50 fps** - PAL high frame rate
- **59.94 fps** - NTSC high frame rate (60p pulldown)
- **60 fps** - High frame rate standard

## Browser Compatibility

The tools work in all modern browsers that support:
- File API
- Drag and Drop API
- ES6 JavaScript features
- CSS Grid and Flexbox

## Security Features

- All processing happens client-side
- No files are uploaded to servers
- Complete privacy for users
- No external dependencies except Google Fonts

## Usage Examples

### Frame Rate Selection
Users can now select their project's frame rate from a dropdown menu before conversion. The tool will:
- Calculate precise middle points based on the selected frame rate
- Generate locators with accurate timecode
- Include frame rate information in the downloaded filename

### File Naming
Downloaded files now include frame rate information:
- 24fps: `filename_locators.txt`
- Other rates: `filename_locators_29.97fps.txt`

## Future Expansion

The interface is designed to easily accommodate additional tools:

1. Add new tool cards to `index.html`
2. Create new tool pages following the `subcap-converter.html` template
3. Update the shared `styles.css` as needed
4. All tools will automatically inherit the consistent design system

## Customization

### Colors
The color scheme can be customized by modifying CSS custom properties in `styles.css`:

```css
:root {
    --primary-color: #000000;
    --accent-color: #ff6b35;
    --success-color: #27ae60;
    /* ... other colors */
}
```

### Branding
- Logo text can be updated in the header sections
- Links to main site are already configured
- Footer branding is consistent with main site

### Adding New Frame Rates
To add support for additional frame rates, update the `fpsSelect` dropdown in `subcap-converter.html` and add corresponding entries to the `fpsInfo` object in the JavaScript.

## Support

For any issues or questions about deployment, refer to the original converter documentation or contact the development team.

---

**Ready for deployment!** 🚀

All files are optimized and ready to be copied to your domain. The enhanced multi-frame rate support makes this tool useful for VFX professionals working with any standard frame rate.
